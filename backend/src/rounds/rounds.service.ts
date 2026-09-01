import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class RoundsService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService) {}

  /**
   * Ensures that a round is addressed through its owning room.
   *
   * WebSocket payloads contain both identifiers, so this check must happen
   * before any operation that broadcasts state to a room. Returning the same
   * error for an unknown round and a round from another room avoids exposing
   * cross-room information through the gateway.
   */
  async assertBelongsToRoom(roundId: string, roomId: string): Promise<void> {
    const round = await this.prisma.round.findFirst({
      where: { id: roundId, roomId },
      select: { id: true },
    });

    if (!round) {
      throw new NotFoundException(`Round ${roundId} not found in room ${roomId}`);
    }
  }

  /**
   * Tire au sort les claims d'une manche, en respectant deux règles.
   *
   * ÉQUILIBRAGE (docs/CLAIMS.md §5) : on vise environ 60 % de fausses. Si le lot
   * ne contenait que des fausses, répondre « fake » à tout suffirait à gagner et
   * le jeu n'aurait plus d'intérêt.
   *
   * PAS DE RÉPÉTITION : on écarte les claims déjà jouées dans ce salon, sinon
   * les habitués reverraient les mêmes extraits et connaîtraient les réponses.
   * Si le stock est épuisé, on rouvre tout plutôt que de refuser la partie.
   */
  private async tirerClaims(tx: Prisma.TransactionClient, roomId: string, nombre: number) {
    const dejaJouees = await tx.roundClaim.findMany({
      where: { round: { roomId } },
      select: { claimId: true },
    });
    const exclues = new Set(dejaJouees.map((rc: { claimId: string }) => rc.claimId));

    // On privilégie les claims avec vidéo, sans les exiger : s'il n'y en a pas
    // assez on complète, plutôt que de refuser la partie.
    //
    // Et seulement les trois formes que le lecteur sait afficher. Le reste
    // (liens morts, Theora que Chrome ne décode plus) donnait un cadre noir
    // sans erreur en console, donc indétectable.
    const lisibles = [
      { mediaRef: { contains: 'upload.wikimedia.org' } },
      { mediaRef: { contains: 'facebook.com/plugins/video.php' } },
      { mediaRef: { contains: '/embed/' } },
    ];
    const cures = await tx.claim.findMany({
      where: { AND: [{ mediaRef: { not: null } }, { OR: lisibles }] },
      select: { id: true, truthLabel: true, category: true },
    });
    const avecVideo =
      cures.length >= nombre
        ? cures
        : await tx.claim.findMany({
            where: { mediaRef: { not: null } },
            select: { id: true, truthLabel: true, category: true },
          });
    const toutes =
      avecVideo.length >= nombre
        ? avecVideo
        : await tx.claim.findMany({ select: { id: true, truthLabel: true, category: true } });
    if (toutes.length < nombre) {
      throw new BadRequestException(
        `Pas assez de claims en base pour une manche de ${nombre} (${toutes.length} disponibles)`,
      );
    }
    const inedites = toutes.filter((c: { id: string }) => !exclues.has(c.id));
    const vivier = inedites.length >= nombre ? inedites : toutes;

    const melanger = <T>(liste: T[]): T[] => {
      // Fisher-Yates : mélange uniforme, contrairement à un sort() aléatoire
      // qui biaise la distribution.
      const copie = [...liste];
      for (let i = copie.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copie[i], copie[j]] = [copie[j], copie[i]];
      }
      return copie;
    };

    const fausses = melanger(vivier.filter((c: { truthLabel: string }) => c.truthLabel === 'FALSE'));
    const vraies = melanger(vivier.filter((c: { truthLabel: string }) => c.truthLabel === 'TRUE'));

    // Un cinquième de la manche par thème, au maximum : sur dix clips, deux du
    // même sujet, donc cinq thèmes différents au minimum.
    //
    // Le corpus est déséquilibré thème par thème — sur l'immigration ou Trump,
    // presque tout est faux. Sans plafond, le joueur apprend à répondre « fake »
    // au sujet plutôt qu'au contenu. Le quart laissait encore trois clips d'un
    // même thème, ce qui suffit à installer ce réflexe.
    //
    // Le repli plus bas dépasse ce plafond en dernier recours, donc resserrer ne
    // risque pas de produire une manche incomplète.
    const plafondTheme = Math.max(2, Math.ceil(nombre / 5));
    const comptes = new Map<string, number>();
    const prendre = (source: Array<{ id: string; truthLabel: string; category: string | null }>, combien: number) => {
      const pris: typeof source = [];
      for (const claim of source) {
        if (pris.length >= combien) break;
        const theme = claim.category ?? 'inconnu';
        const dejaPris = comptes.get(theme) ?? 0;
        if (dejaPris >= plafondTheme) continue;
        comptes.set(theme, dejaPris + 1);
        pris.push(claim);
      }
      return pris;
    };

    const cibleFausses = Math.round(nombre * 0.6);
    const choisies = [
      ...prendre(fausses, cibleFausses),
      ...prendre(vraies, nombre - cibleFausses),
    ];
    // Une catégorie à court : on complète avec l'autre, en respectant d'abord
    // le plafond. On ne le dépasse qu'en dernier recours — sinon ce chemin, qui
    // sert souvent, contournait le garde-fou posé plus haut.
    if (choisies.length < nombre) {
      const disponibles = melanger(vivier.filter((c: { id: string }) => !choisies.some((x) => x.id === c.id)));
      choisies.push(...prendre(disponibles, nombre - choisies.length));
      if (choisies.length < nombre) {
        const derniers = disponibles.filter((c) => !choisies.some((x) => x.id === c.id));
        choisies.push(...derniers.slice(0, nombre - choisies.length));
      }
    }
    // Mélange, puis entrelacement des thèmes : le plafond empêche qu'un sujet
    // domine, mais un tirage au hasard peut encore en aligner trois à la suite.
    // On prend le premier clip dont le thème diffère du précédent.
    const restant = melanger(choisies);
    const ordonnees: typeof restant = [];
    let themePrecedent: string | null = null;
    while (restant.length > 0) {
      let index = restant.findIndex((c) => (c.category ?? 'inconnu') !== themePrecedent);
      if (index === -1) index = 0;
      const [claim] = restant.splice(index, 1);
      themePrecedent = claim.category ?? 'inconnu';
      ordonnees.push(claim);
    }
    return ordonnees.map((c: { id: string }) => c.id);
  }

  async create(
    data: { roomId: string; claimIds?: string[]; claimCount?: number; durationSeconds: number },
    createdById: string,
  ) {
    // Liste imposée : on la valide comme avant. Sinon on tirera au sort dans la
    // transaction (il faut y être pour lire les claims déjà jouées du salon).
    const imposees = data.claimIds ? [...new Set(data.claimIds)] : null;
    if (imposees && imposees.length !== data.claimIds!.length) {
      throw new BadRequestException('A claim may appear only once in a round');
    }
    if (imposees && imposees.length === 0) {
      throw new BadRequestException('A round must contain at least one claim');
    }
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const room = await tx.room.findUnique({ where: { id: data.roomId } });
      if (!room) throw new NotFoundException(`Room ${data.roomId} not found`);
      if (room.createdBy !== createdById) throw new ForbiddenException('Only the room host may create rounds');
      if (room.status === 'FINISHED') throw new BadRequestException('Cannot add rounds to a finished room');
      const activeRound = await tx.round.findFirst({ where: { roomId: data.roomId, status: { in: ['COUNTDOWN', 'OPEN', 'LOCKED'] as any } } });
      if (activeRound) throw new ConflictException('This room already has an active round');
      // Soit la liste imposée, soit un tirage automatique (8 clips par défaut,
      // ce qui donne une manche d'une durée raisonnable).
      const distinctClaimIds = imposees ?? (await this.tirerClaims(tx, data.roomId, data.claimCount ?? 8));
      const claims = await tx.claim.findMany({ where: { id: { in: distinctClaimIds } }, select: { id: true } });
      if (claims.length !== distinctClaimIds.length) throw new BadRequestException('One or more claims do not exist');
      const opensAt = new Date(Date.now() + 3_000);
      const locksAt = new Date(opensAt.getTime() + data.durationSeconds * 1000);
      const round = await tx.round.create({ data: { roomId: data.roomId, status: 'COUNTDOWN' as any, opensAt, locksAt } });
      await tx.roundClaim.createMany({ data: distinctClaimIds.map((claimId, orderIndex) => ({ roundId: round.id, claimId, orderIndex })) });
      await tx.room.update({ where: { id: data.roomId }, data: { status: 'IN_PROGRESS' } });
      return tx.round.findUniqueOrThrow({
        where: { id: round.id },
        select: {
          id: true, roomId: true, status: true, opensAt: true, locksAt: true, revealedAt: true, createdAt: true, updatedAt: true,
          roundClaims: { include: { claim: { select: { id: true, text: true, mediaRef: true, videoEndS: true, category: true, sourceUrl: true } } } },
        },
      });
    });
  }

  async findByRoom(roomId: string) {
    return this.prisma.round.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, roomId: true, status: true, opensAt: true, locksAt: true, revealedAt: true, createdAt: true, updatedAt: true },
    });
  }

  async findOne(id: string) {
    const round = await this.prisma.round.findUnique({
      where: { id },
      include: { roundClaims: { include: { claim: { select: { id: true, text: true, mediaRef: true, videoEndS: true, category: true, sourceUrl: true } } } }, bets: { select: { id: true, userId: true, stake: true, payout: true, result: true, createdAt: true } }, clipVotes: { select: { id: true, userId: true, claimId: true, isFake: true, createdAt: true } } },
    });
    if (!round) throw new NotFoundException(`Round ${id} not found`);
    const { bets, clipVotes: _clipVotes, ...safeRound } = round;
    const revealed = round.status === 'REVEALED' || String(round.status) === 'FINISHED';
    return revealed ? { ...safeRound, bets } : safeRound;
  }

  async lock(id: string, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id }, select: { room: { select: { createdBy: true, status: true } } } });
    if (!round) throw new NotFoundException(`Round ${id} not found`);
    if (round.room.createdBy !== userId) throw new ForbiddenException('Only the room host may lock a round');
    if (round.room.status === 'FINISHED') throw new BadRequestException('Cannot modify a finished room');
    const locked = await this.lockIfDueOrOpen(id, true);
    if (!locked) throw new BadRequestException('Only an open round can be locked');
    return locked;
  }

  async reveal(id: string, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id }, include: { room: true } });
    if (!round) throw new NotFoundException(`Round ${id} not found`);
    if (round.room.createdBy !== userId) throw new ForbiddenException('Only the room host may reveal a round');
    if (round.room.status === 'FINISHED') throw new BadRequestException('Cannot modify a finished room');
    return this.revealAndSettle(id);
  }

  /** Atomically transitions an expired OPEN round to LOCKED. */
  async openIfDue(id: string) {
    const claimed = await this.prisma.round.updateMany({
      where: { id, status: 'COUNTDOWN' as any, opensAt: { lte: new Date() }, room: { status: { not: 'FINISHED' } } },
      data: { status: 'OPEN' },
    });
    return claimed.count === 1 ? this.findOne(id) : null;
  }

  /** Atomically transitions an expired OPEN round to LOCKED. */
  async lockIfDue(id: string) {
    return this.lockIfDueOrOpen(id, true);
  }

  private async lockIfDueOrOpen(id: string, dueOnly: boolean) {
    const now = new Date();
    const claimed = await this.prisma.round.updateMany({
      where: {
        id,
        status: 'OPEN',
        room: { status: { not: 'FINISHED' } },
        ...(dueOnly ? { locksAt: { lte: now } } : {}),
      },
      data: { status: 'LOCKED' },
    });
    return claimed.count === 1 ? this.findOne(id) : null;
  }

  /** Resolves a locked round without requiring a connected host. */
  async revealAndSettle(id: string) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const round = await tx.round.findUnique({ where: { id }, include: { room: true, roundClaims: { select: { id: true } }, bets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, clipVotes: { include: { claim: { select: { truthLabel: true } } } } } });
      if (!round) throw new NotFoundException(`Round ${id} not found`);
      if (round.room?.status === 'FINISHED') throw new BadRequestException('Cannot reveal a round in a finished room');
      if (round.status !== 'LOCKED') throw new BadRequestException('Only a locked round can be revealed');
      if (Array.isArray(round.roundClaims) && round.roundClaims.length === 0) throw new BadRequestException('Cannot reveal a round without claims');
      const claimed = await tx.round.updateMany({ where: { id, status: 'LOCKED', room: { status: { not: 'FINISHED' } } }, data: { status: 'REVEALED', revealedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException('Round has already been resolved');
      if (round.bets.length === 0) return tx.round.findUniqueOrThrow({ where: { id } });
      const scores = round.bets.map((bet) => ({ bet, correct: round.clipVotes.filter((vote) => vote.userId === bet.userId && ((vote.isFake && vote.claim.truthLabel === 'FALSE') || (!vote.isFake && vote.claim.truthLabel === 'TRUE'))).length }));
      const bestScore = Math.max(...scores.map(({ correct }) => correct));
      const winners = scores.filter(({ correct }) => correct === bestScore).map(({ bet }) => bet);
      const pot = round.bets.reduce((total: number, bet: { stake: number }) => total + bet.stake, 0);
      const basePayout = Math.floor(pot / winners.length);
      const remainder = pot % winners.length;
      for (const bet of round.bets) {
        const winnerIndex = winners.findIndex((winner: { id: string }) => winner.id === bet.id);
        const payout = winnerIndex === -1 ? 0 : basePayout + (winnerIndex < remainder ? 1 : 0);
        await tx.bet.update({ where: { id: bet.id }, data: { result: winnerIndex === -1 ? 'LOSS' : 'WIN', payout } });
        if (payout > 0) await this.ledger.creditPayout(tx, bet.userId, payout, `payout:${bet.id}`);
      }
      return tx.round.findUniqueOrThrow({ where: { id }, include: { bets: true, clipVotes: true } });
    });
  }

  /** Marks a revealed round as finished and reopens its room for the next one. */
  async finish(id: string) {
    const finished = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.round.updateMany({ where: { id, status: 'REVEALED' }, data: { status: 'FINISHED' as any } });
      if (updated.count !== 1) return null;
      const round = await tx.round.findUniqueOrThrow({ where: { id }, select: { roomId: true } });
      await tx.room.updateMany({ where: { id: round.roomId, status: 'IN_PROGRESS' }, data: { status: 'WAITING' } });
      return tx.round.findUniqueOrThrow({ where: { id }, include: { bets: true, clipVotes: true } });
    });
    return finished;
  }

  /**
   * Classement d'une manche : qui a vu juste, et combien il gagne ou perd.
   *
   * Calculé à la lecture, pas stocké : votes et mises sont déjà en base, un
   * score dupliqué finirait par diverger.
   */
  async classement(roundId: string) {
    const round = await this.prisma.round.findUnique({
      where: { id: roundId },
      select: {
        clipVotes: { select: { userId: true, claimId: true, isFake: true } },
        bets: { select: { userId: true, stake: true, payout: true } },
        roundClaims: { select: { claim: { select: { id: true, truthLabel: true } } } },
      },
    });
    if (!round) return [];

    // Un vote est juste si « c'est un fake » coïncide avec un verdict FALSE.
    const estFausse = new Map(
      round.roundClaims.map(({ claim }) => [claim.id, claim.truthLabel === 'FALSE']),
    );

    const parJoueur = new Map<string, { correctCount: number; creditsChange: number }>();
    const entree = (userId: string) => {
      if (!parJoueur.has(userId)) parJoueur.set(userId, { correctCount: 0, creditsChange: 0 });
      return parJoueur.get(userId)!;
    };

    for (const vote of round.clipVotes) {
      const attendu = estFausse.get(vote.claimId);
      if (attendu === undefined) continue;
      if (vote.isFake === attendu) entree(vote.userId).correctCount += 1;
    }

    // payout est null tant que la manche n'est pas réglée : dans ce cas le
    // joueur a engagé sa mise sans retour, donc la variation vaut -stake.
    for (const pari of round.bets) {
      entree(pari.userId).creditsChange += (pari.payout ?? 0) - pari.stake;
    }

    if (parJoueur.size === 0) return [];
    // Les faux joueurs du chat votent aussi. Ils n'ont rien à faire dans le
    // classement d'une partie entre humains, et ils y noyaient les vrais.
    const utilisateurs = await this.prisma.user.findMany({
      where: { id: { in: [...parJoueur.keys()] }, role: { not: 'BOT' } },
      select: { id: true, displayName: true, email: true },
    });
    for (const id of [...parJoueur.keys()]) {
      if (!utilisateurs.some((u) => u.id === id)) parJoueur.delete(id);
    }
    const nom = new Map(
      utilisateurs.map((u) => [u.id, u.displayName || u.email.split('@')[0]]),
    );

    return [...parJoueur.entries()]
      .map(([userId, valeurs]) => ({ userId, username: nom.get(userId) ?? 'joueur', ...valeurs }))
      // Le plus précis d'abord : c'est le classement que le jeu met en avant.
      .sort((a, b) => b.correctCount - a.correctCount || b.creditsChange - a.creditsChange);
  }
}
