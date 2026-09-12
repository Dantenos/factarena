import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { RoomPresenceService } from '../rooms/room-presence.service';

export const ACHIEVEMENT_LABELS = {
  FIRST_WIN: 'Dans le petit bain',
  CREDITS_100: 'Début de la richesse',
  PERFECT_GAME: 'Pro de la fakenews',
  BET_250_WIN: 'Même pas peur',
  TEN_WINS: 'Imbattable',
} as const;

@Injectable()
export class RoundsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => LedgerService)) private readonly ledger: LedgerService,
    @Optional() private readonly roomPresence?: RoomPresenceService,
  ) {}

  async assertBelongsToRoom(roundId: string, roomId: string): Promise<void> {
    const round = await this.prisma.round.findFirst({
      where: { id: roundId, roomId },
      select: { id: true },
    });

    if (!round) {
      throw new NotFoundException(`La manche ${roundId} est introuvable dans le salon ${roomId}`);
    }
  }

  async prepare(roomId: string, userId: string, claimCount: number) {
    if (!Number.isInteger(claimCount) || claimCount < 1 || claimCount > 20) {
      throw new BadRequestException('Nombre de clips invalide');
    }
    const room = await this.prisma.room.findUnique({ where: { id: roomId }, select: { createdBy: true, status: true } });
    if (!room) throw new NotFoundException(`Salon ${roomId} introuvable`);
    if (room.createdBy !== userId) throw new ForbiddenException('Seul l’hôte du salon peut préparer une manche');
    if (room.status !== 'WAITING') throw new BadRequestException('Cette room a déjà été lancée');
    const existing = await this.prisma.round.findFirst({ where: { roomId, status: 'COUNTDOWN' }, orderBy: { createdAt: 'desc' } });
    if (existing) return this.findOne(existing.id);
    await this.prisma.$transaction(async (tx) => {
      const claimIds = await this.tirerClaims(tx, roomId, claimCount);
      const round = await tx.round.create({
        data: {
          roomId,
          status: 'COUNTDOWN' as any,
          opensAt: new Date('2099-01-01T00:00:00.000Z'),
          locksAt: new Date('2099-01-01T00:00:00.000Z'),
          roundClaims: { create: claimIds.map((claimId, orderIndex) => ({ claimId, orderIndex })) },
        },
      });
      return round.id;
    });
    const prepared = await this.prisma.round.findFirst({ where: { roomId, status: 'COUNTDOWN' }, orderBy: { createdAt: 'desc' } });
    if (!prepared) throw new NotFoundException(`La manche du salon ${roomId} est introuvable`);
    return this.findOne(prepared.id);
  }

  async start(id: string, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id }, select: { roomId: true, status: true } });
    if (!round) throw new NotFoundException(`La manche ${id} est introuvable`);
    const room = await this.prisma.room.findUnique({ where: { id: round.roomId }, select: { createdBy: true, status: true } });
    if (!room) throw new NotFoundException(`Salon ${round.roomId} introuvable`);
    if (room.createdBy !== userId) throw new ForbiddenException('Seul l’hôte du salon peut lancer la manche');
    if (room.status === 'FINISHED') throw new BadRequestException('Cette room est terminée');
    if (round.status !== 'COUNTDOWN') throw new BadRequestException('La manche est déjà lancée');
    const members = await this.roomPresence?.getMemberIds(round.roomId) ?? [];
    if (members.length < 2) throw new BadRequestException('Il faut au moins 2 joueurs présents pour lancer une manche');
    const bets = await this.prisma.bet.findMany({ where: { roundId: id }, select: { userId: true } });
    const missing = members.filter((memberId) => !bets.some((bet) => bet.userId === memberId));
    if (missing.length > 0) throw new BadRequestException('Tous les joueurs n’ont pas encore misé.');
    return this.prisma.$transaction(async (tx) => {
      await tx.room.update({ where: { id: round.roomId }, data: { status: 'IN_PROGRESS' } });
      return tx.round.update({ where: { id }, data: { status: 'OPEN', currentClipIndex: 0, opensAt: new Date() } });
    });
  }

  async next(id: string, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id }, include: { room: true, roundClaims: { orderBy: { orderIndex: 'asc' }, select: { claimId: true, orderIndex: true } } } });
    if (!round) throw new NotFoundException(`La manche ${id} est introuvable`);
    if (round.room.createdBy !== userId) throw new ForbiddenException('Seul l’hôte peut passer au clip suivant');
    if (round.status !== 'OPEN') throw new BadRequestException('La manche n’est pas ouverte');
    const claim = round.roundClaims[round.currentClipIndex];
    if (!claim) throw new BadRequestException('Le clip courant est introuvable');
    await this.assertEveryoneVoted(id, round.roomId, claim.claimId);
    if (round.currentClipIndex >= round.roundClaims.length - 1) {
      throw new BadRequestException('Tous les joueurs doivent voter sur le dernier clip avant de voir le verdict');
    }
    return this.prisma.round.update({ where: { id }, data: { currentClipIndex: { increment: 1 } } });
  }

  private async assertEveryoneVoted(roundId: string, roomId: string, claimId: string) {
    const members = await this.roomPresence?.getMemberIds(roomId) ?? [];
    const votes = await this.prisma.clipVote.findMany({ where: { roundId, claimId }, select: { userId: true } });
    const missing = members.filter((memberId) => !votes.some((vote) => vote.userId === memberId));
    if (missing.length > 0) throw new BadRequestException('Tous les joueurs n’ont pas encore voté.');
  }

  private async tirerClaims(tx: Prisma.TransactionClient, roomId: string, nombre: number) {
    const dejaJouees = await tx.roundClaim.findMany({
      where: { round: { roomId } },
      select: { claimId: true },
    });
    const exclues = new Set(dejaJouees.map((rc: { claimId: string }) => rc.claimId));

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
        `Pas assez d’affirmations en base pour une manche de ${nombre} (${toutes.length} disponibles)`,
      );
    }
    const inedites = toutes.filter((c: { id: string }) => !exclues.has(c.id));
    const vivier = inedites.length >= nombre ? inedites : toutes;

    const melanger = <T>(liste: T[]): T[] => {
      const copie = [...liste];
      for (let i = copie.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copie[i], copie[j]] = [copie[j], copie[i]];
      }
      return copie;
    };

    const fausses = melanger(vivier.filter((c: { truthLabel: string }) => c.truthLabel === 'FALSE'));
    const vraies = melanger(vivier.filter((c: { truthLabel: string }) => c.truthLabel === 'TRUE'));

    const verdictsParTheme = new Map<string, Set<string>>();
    for (const claim of vivier) {
      const theme = claim.category ?? 'inconnu';
      if (!verdictsParTheme.has(theme)) verdictsParTheme.set(theme, new Set());
      verdictsParTheme.get(theme)!.add(claim.truthLabel);
    }
    const themesHomogenes = new Set(
      [...verdictsParTheme].filter(([, verdicts]) => verdicts.size === 1).map(([theme]) => theme),
    );

    const plafondHomogene = Math.max(2, Math.ceil(nombre / 5));
    const plafondMixte = Math.ceil(nombre / 2);
    const comptes = new Map<string, number>();
    const prendre = (source: Array<{ id: string; truthLabel: string; category: string | null }>, combien: number) => {
      const pris: typeof source = [];
      for (const claim of source) {
        if (pris.length >= combien) break;
        const theme = claim.category ?? 'inconnu';
        const dejaPris = comptes.get(theme) ?? 0;
        if (dejaPris >= (themesHomogenes.has(theme) ? plafondHomogene : plafondMixte)) continue;
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

    if (choisies.length < nombre) {
      const disponibles = melanger(vivier.filter((c: { id: string }) => !choisies.some((x) => x.id === c.id)));
      choisies.push(...prendre(disponibles, nombre - choisies.length));
      if (choisies.length < nombre) {
        const derniers = disponibles.filter((c) => !choisies.some((x) => x.id === c.id));
        choisies.push(...derniers.slice(0, nombre - choisies.length));
      }
    }

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
    const imposees = data.claimIds ? [...new Set(data.claimIds)] : null;
    if (imposees && imposees.length !== data.claimIds!.length) {
      throw new BadRequestException('Une affirmation ne peut apparaître qu’une seule fois dans une manche');
    }
    if (imposees && imposees.length === 0) {
      throw new BadRequestException('Une manche doit contenir au moins une affirmation');
    }
    const joueursPresents = await this.roomPresence?.getMemberIds(data.roomId);
    if (joueursPresents && joueursPresents.length < 2) {
      throw new BadRequestException('Il faut au moins 2 joueurs présents pour lancer une manche');
    }
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const roomLock = await tx.room.updateMany({
        where: { id: data.roomId },
        data: { updatedAt: new Date() },
      });
      if (roomLock.count !== 1) throw new NotFoundException(`Salon ${data.roomId} introuvable`);
      const room = await tx.room.findUnique({ where: { id: data.roomId } });
      if (!room) throw new NotFoundException(`Salon ${data.roomId} introuvable`);
      if (room.createdBy !== createdById) throw new ForbiddenException('Seul l’hôte du salon peut créer des manches');
      if (room.status === 'FINISHED') throw new BadRequestException('Impossible d’ajouter une manche à un salon terminé');
      const activeRound = await tx.round.findFirst({ where: { roomId: data.roomId, status: { in: ['COUNTDOWN', 'OPEN', 'LOCKED'] as any } } });
      if (activeRound) return { alreadyActive: true as const };
      const distinctClaimIds = imposees ?? (await this.tirerClaims(tx, data.roomId, data.claimCount ?? 8));
      const claims = await tx.claim.findMany({ where: { id: { in: distinctClaimIds } }, select: { id: true } });
      if (claims.length !== distinctClaimIds.length) throw new BadRequestException('Une ou plusieurs affirmations sont introuvables');
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
    if (!round) throw new NotFoundException(`La manche ${id} est introuvable`);
    const { bets, clipVotes: _clipVotes, ...safeRound } = round;
    const revealed = round.status === 'REVEALED' || String(round.status) === 'FINISHED';
    return revealed ? { ...safeRound, bets } : safeRound;
  }

  async lock(id: string, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id }, select: { room: { select: { createdBy: true, status: true } } } });
    if (!round) throw new NotFoundException(`La manche ${id} est introuvable`);
    if (round.room.createdBy !== userId) throw new ForbiddenException('Seul l’hôte du salon peut verrouiller une manche');
    if (round.room.status === 'FINISHED') throw new BadRequestException('Impossible de modifier un salon terminé');
    const locked = await this.lockIfDueOrOpen(id, true);
    if (!locked) throw new BadRequestException('Seule une manche ouverte peut être verrouillée');
    return locked;
  }

  async reveal(id: string, userId: string) {
    const round = await this.prisma.round.findUnique({ where: { id }, include: { room: true } });
    if (!round) throw new NotFoundException(`La manche ${id} est introuvable`);
    if (round.room.createdBy !== userId) throw new ForbiddenException('Seul l’hôte du salon peut révéler une manche');
    if (round.room.status === 'FINISHED') throw new BadRequestException('Impossible de modifier un salon terminé');
    if (round.status !== 'OPEN') throw new BadRequestException('La manche n’est pas ouverte');
    const dernierClip = await this.prisma.roundClaim.findFirst({ where: { roundId: id }, orderBy: { orderIndex: 'desc' }, select: { claimId: true, orderIndex: true } });
    if (!dernierClip || round.currentClipIndex !== dernierClip.orderIndex) throw new BadRequestException('L’hôte doit atteindre le dernier clip avant de voir le verdict');
    await this.assertEveryoneVoted(id, round.roomId, dernierClip.claimId);
    return this.revealAndSettle(id);
  }

  async openIfDue(id: string) {
    const claimed = await this.prisma.round.updateMany({
      where: { id, status: 'COUNTDOWN' as any, opensAt: { lte: new Date() }, room: { status: { not: 'FINISHED' } } },
      data: { status: 'OPEN' },
    });
    return claimed.count === 1 ? this.findOne(id) : null;
  }

  async lockIfDue(id: string) {
    return this.lockIfDueOrOpen(id, true);
  }

  async lockIfEveryoneVoted(id: string) {
    const [clips, parieurs] = await Promise.all([
      this.prisma.roundClaim.count({ where: { roundId: id } }),
      this.prisma.bet.findMany({ where: { roundId: id }, select: { userId: true } }),
    ]);
    if (clips === 0 || parieurs.length === 0) return null;

    const votes = await this.prisma.clipVote.groupBy({
      by: ['userId'],
      where: { roundId: id, userId: { in: parieurs.map((b) => b.userId) } },
      _count: { _all: true },
    });
    const compte = new Map(votes.map((v) => [v.userId, v._count._all]));
    if (!parieurs.every((b) => compte.get(b.userId) === clips)) return null;

    return this.lockIfDueOrOpen(id, false);
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

  async revealAndSettle(id: string) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const round = await tx.round.findUnique({ where: { id }, include: { room: true, roundClaims: { select: { id: true } }, bets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, clipVotes: { include: { claim: { select: { truthLabel: true } } } } } });
      if (!round) throw new NotFoundException(`La manche ${id} est introuvable`);
      if (round.room?.status === 'FINISHED') throw new BadRequestException('Impossible de révéler une manche dans un salon terminé');
      if (!['OPEN', 'LOCKED'].includes(String(round.status))) throw new BadRequestException('La manche ne peut pas encore être révélée');
      if (Array.isArray(round.roundClaims) && round.roundClaims.length === 0) throw new BadRequestException('Impossible de révéler une manche sans affirmation');
      const claimed = await tx.round.updateMany({ where: { id, status: round.status === 'LOCKED' ? 'LOCKED' : { in: ['OPEN', 'LOCKED'] }, room: { status: { not: 'FINISHED' } } }, data: { status: 'REVEALED', revealedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException('La manche a déjà été réglée');
      const bets = round.bets ?? [];
      if (bets.length === 0) {
        if (tx.room?.updateMany) await tx.room.updateMany({ where: { id: round.roomId, status: 'IN_PROGRESS' }, data: { status: 'FINISHED' } });
        return tx.round.findUniqueOrThrow({ where: { id } });
      }
      const scores = bets.map((bet) => ({ bet, correct: round.clipVotes.filter((vote) => vote.userId === bet.userId && ((vote.isFake && vote.claim.truthLabel === 'FALSE') || (!vote.isFake && vote.claim.truthLabel === 'TRUE'))).length }));
      const bestScore = Math.max(...scores.map(({ correct }) => correct));
      const winners = scores.filter(({ correct }) => correct === bestScore).map(({ bet }) => bet);
      const pot = bets.reduce((total: number, bet: { stake: number }) => total + bet.stake, 0);
      const totalWinningStakes = winners.reduce((total: number, bet: { stake: number }) => total + bet.stake, 0);
      const payouts = new Map<string, number>();
      const fractions = winners.map((bet) => {
        const numerator = pot * bet.stake;
        const payout = Math.floor(numerator / totalWinningStakes);
        payouts.set(bet.id, payout);
        return { id: bet.id, fraction: numerator % totalWinningStakes };
      });
      let remainder = pot - [...payouts.values()].reduce((total, payout) => total + payout, 0);
      fractions.sort((a, b) => b.fraction - a.fraction);
      for (const winner of fractions) {
        if (remainder === 0) break;
        payouts.set(winner.id, (payouts.get(winner.id) ?? 0) + 1);
        remainder -= 1;
      }
      for (const bet of bets) {
        const payout = payouts.get(bet.id) ?? 0;
        await tx.bet.update({ where: { id: bet.id }, data: { result: payouts.has(bet.id) ? 'WIN' : 'LOSS', payout } });
        if (payout > 0) await this.ledger.creditPayout(tx, bet.userId, payout, `payout:${bet.id}`);
      }

      const gagnants = await tx.user.findMany({
        where: { id: { in: winners.map((bet) => bet.userId) }, role: { not: 'BOT' } },
        select: { id: true, experience: true, level: true },
      });
      for (const gagnant of gagnants) {
        let experience = gagnant.experience + 25;
        let level = gagnant.level;
        while (experience >= level * 25) {
          experience -= level * 25;
          level += 1;
        }
        await tx.user.update({ where: { id: gagnant.id }, data: { experience, level } });
      }
      const votesParJoueur = new Map<string, number>();
      for (const score of scores) votesParJoueur.set(score.bet.userId, score.correct);
      const gainsParJoueur = new Map<string, number>();
      for (const bet of bets) gainsParJoueur.set(bet.userId, (payouts.get(bet.id) ?? 0) - bet.stake);
      const gagnantsHumains = gagnants.map((gagnant) => gagnant.id);
      for (const userId of gagnantsHumains) {
        const userBets = bets.filter((bet) => bet.userId === userId);
        const totalVictoires = await tx.bet.count({ where: { userId, result: 'WIN' } });
        const conditions = [
          { key: 'FIRST_WIN', unlocked: true },
          { key: 'CREDITS_100', unlocked: (gainsParJoueur.get(userId) ?? 0) >= 100 },
          { key: 'PERFECT_GAME', unlocked: (votesParJoueur.get(userId) ?? 0) === 5 },
          { key: 'BET_250_WIN', unlocked: userBets.some((bet) => bet.stake === 250) },
          { key: 'TEN_WINS', unlocked: totalVictoires >= 10 },
        ].filter((condition) => condition.unlocked);
        for (const condition of conditions) {
          await tx.achievementUnlock.createMany({
            data: { userId, achievementKey: condition.key },
            skipDuplicates: true,
          });
        }
      }
      if (tx.room?.updateMany) await tx.room.updateMany({ where: { id: round.roomId, status: 'IN_PROGRESS' }, data: { status: 'FINISHED' } });
      return tx.round.findUniqueOrThrow({ where: { id }, include: { bets: true, clipVotes: true } });
    });
  }

  async finish(id: string) {
    const finished = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.round.updateMany({ where: { id, status: 'REVEALED' }, data: { status: 'FINISHED' as any } });
      if (updated.count !== 1) return null;
      const round = await tx.round.findUniqueOrThrow({ where: { id }, select: { roomId: true } });
      await tx.room.updateMany({ where: { id: round.roomId, status: { in: ['WAITING', 'IN_PROGRESS'] } }, data: { status: 'FINISHED' } });
      return tx.round.findUniqueOrThrow({ where: { id }, include: { bets: true, clipVotes: true } });
    });
    return finished;
  }

  async classement(roundId: string) {
    const round = await this.prisma.round.findUnique({
      where: { id: roundId },
      select: {
        clipVotes: { select: { userId: true, claimId: true, isFake: true } },
        bets: { select: { userId: true, stake: true, payout: true } },
        revealedAt: true,
        roundClaims: { select: { claim: { select: { id: true, truthLabel: true } } } },
      },
    });
    if (!round) return [];

    const estFausse = new Map(
      round.roundClaims.map(({ claim }) => [claim.id, claim.truthLabel === 'FALSE']),
    );

    const parJoueur = new Map<string, { correctCount: number; creditsChange: number; experienceGained: number }>();
    const entree = (userId: string) => {
      if (!parJoueur.has(userId)) parJoueur.set(userId, { correctCount: 0, creditsChange: 0, experienceGained: 0 });
      return parJoueur.get(userId)!;
    };

    for (const vote of round.clipVotes) {
      const attendu = estFausse.get(vote.claimId);
      if (attendu === undefined) continue;
      if (vote.isFake === attendu) entree(vote.userId).correctCount += 1;
    }

    for (const pari of round.bets) {
      entree(pari.userId).creditsChange += (pari.payout ?? 0) - pari.stake;
    }

    const joueursAvecPari = new Set(round.bets.map((pari) => pari.userId));
    const scores = [...parJoueur.entries()].filter(([userId]) => joueursAvecPari.has(userId));
    const bestScore = scores.length > 0 ? Math.max(...scores.map(([, values]) => values.correctCount)) : -1;
    for (const [, values] of scores) {
      if (values.correctCount === bestScore) values.experienceGained = 25;
    }

    if (parJoueur.size === 0) return [];

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

    const utilisateursHumains = [...parJoueur.keys()].filter((id) => utilisateurs.some((u) => u.id === id));
    const recompenses = await this.prisma.achievementUnlock.findMany({
      where: {
        userId: { in: utilisateursHumains },
        unlockedAt: round.revealedAt ? { gte: round.revealedAt } : undefined,
      },
      select: { userId: true, achievementKey: true },
      orderBy: { unlockedAt: 'asc' },
    });
    const recompensesParJoueur = new Map<string, string[]>();
    for (const recompense of recompenses) {
      const liste = recompensesParJoueur.get(recompense.userId) ?? [];
      liste.push(recompense.achievementKey);
      recompensesParJoueur.set(recompense.userId, liste);
    }

    return [...parJoueur.entries()]
      .map(([userId, valeurs]) => ({ userId, username: nom.get(userId) ?? 'joueur', ...valeurs, achievementsUnlocked: recompensesParJoueur.get(userId) ?? [] }))
      .sort((a, b) => b.correctCount - a.correctCount || b.creditsChange - a.creditsChange);
  }
}
