import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);

  private readonly minuteries = new Map<string, NodeJS.Timeout[]>();
  private comptesCache?: Map<string, string>;
  private readonly pioches = new Map<string, Record<string, () => string>>();

  private readonly avis = new Map<string, Map<string, string>>();
  private readonly dernierMessage = new Map<string, number>();

  private readonly conversation = new Map<string, Array<{ auteur: string; contenu: string }>>();
  private readonly dernierLLM = new Map<string, number>();
  private static readonly ECART_LLM_MS = 5_000;
  private static readonly MEMOIRE = 8;

  private static readonly AMBIANCE_PAR_CLIP = 0.3;
  private static readonly SILENCE_PREMIER_AVIS = 0.6;
  private static readonly SILENCE_DEJA_POSITIONNE = 0.95;
  private static readonly PROBA_REBOND = 0.15;
  private static readonly ECART_MESSAGE_MS = 12_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  private static readonly PERSONNAGES: Record<string, string> = {
    mreynaud: "Tu es mreynaud, un joueur sûr de lui qui tranche vite et déteste "
      + "qu'on le contredise. Tu parles sec, tu balances des arguments d'autorité.",
    lchen: "Tu es lchen, un joueur qui se pique de tout reconnaître : montage, "
      + "IA, recyclage d'une vieille vidéo. Tu es condescendant et un peu jargonneux.",
    adiallo: "Tu es adiallo, un joueur distrait qui suit mal, se plaint de sa "
      + "connexion, demande qu'on répète et lâche des remarques à côté.",
  };

  noter(roomId: string, auteur: string, contenu: string): void {
    const fil = this.conversation.get(roomId) ?? [];
    fil.push({ auteur, contenu });
    this.conversation.set(roomId, fil.slice(-BotsService.MEMOIRE));
  }

  private async phraseLLM(roomId: string, bot: string, consigne: string): Promise<string | null> {
    const maintenant = Date.now();
    if (maintenant - (this.dernierLLM.get(roomId) ?? 0) < BotsService.ECART_LLM_MS) return null;
    this.dernierLLM.set(roomId, maintenant);

    const fil = (this.conversation.get(roomId) ?? [])
      .map((m) => `${m.auteur}: ${m.contenu}`)
      .join('\n');

    const prompt = [
      BotsService.PERSONNAGES[bot] ?? 'Tu es un joueur ordinaire.',
      "Tu joues à un jeu où l'on regarde de courtes vidéos et où l'on dit si elles sont",
      "authentiques ou trompeuses. Tu discutes dans le chat avec les autres joueurs.",
      '',
      fil ? `Derniers messages du chat :\n${fil}` : '',
      '',
      consigne,
      '',
      `Tu écris SOUS le pseudo « ${bot} ». Ne te cite jamais toi-même à la `
        + "troisième personne et ne commence pas ta phrase par ton propre pseudo.",
      'Réponds en UNE seule phrase courte, en français, sur le ton du chat de jeu :',
      "minuscules, pas de ponctuation soignée, pas d'emoji, aucune source, aucun lien.",
      "Tu n'es pas un assistant et tu ne le dis jamais. Écris seulement la phrase.",
    ].join('\n');

    try {
      const reponse = await this.ai.chat(prompt, undefined, `bots:${roomId}`);
      const donnees = reponse?.data as { answer?: string; text?: string } | undefined;
      const brut = (donnees?.answer ?? donnees?.text ?? '').trim();
      if (!brut) return null;
      const phrase = brut.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
      let propre = phrase.replace(/^["'«»\s-]+|["'«»\s]+$/g, '');
      propre = propre.replace(new RegExp(`^@?${bot}\\s*[:,-]?\\s*`, 'i'), '').trim();
      if (new RegExp(`^@?${bot}\\b`, 'i').test(propre)) return null;
      return propre.length >= 3 ? propre.slice(0, 180) : null;
    } catch (error) {
      this.logger.debug(`Bot LLM indisponible : ${String(error)}`);
      return null;
    }
  }

  private static readonly TROMPEURS = ['mreynaud', 'lchen'];
  private static readonly BAVARD = 'adiallo';

  private static readonly CERTITUDES = [
    "franchement celle-là c'est {r} à 100%, je l'ai déjà vue passer",
    "{r} évidemment, y a même pas débat",
    "mon frère bosse dans le milieu, c'est {r} sans hésiter",
    "j'ai vu un article dessus la semaine dernière, c'est {r}",
    "clairement {r}, la qualité de l'image trahit tout",
    "{r}, mon prof de physique nous avait fait le test en cours",
    "alors là c'est {r}, j'ai fait un exposé dessus au lycée",
    "{r} les gars, faites moi confiance sur ce coup",
    "c'est {r}, ça a été démonté mille fois sur les réseaux",
    "{r}. le montage se voit à l'œil nu franchement",
    "j'ai un pote qui bosse là-dedans, il m'a confirmé que c'était {r}",
    "{r} sans discuter, j'ai lu une étude là-dessus",
    "vous vous faites avoir, c'est {r} et c'est pas la première fois",
    "{r}, ma sœur avait fait un TPE sur le sujet",
    "c'est {r}, ce genre de séquence est toujours refaite en studio",
    "{r} carrément, suffit de regarder deux secondes",
    "moi je dis {r}, et j'ai rarement tort sur ces trucs",
    "{r}, on nous a déjà servi la même l'an dernier",
  ];

  private static readonly CERTITUDES_SUJET = [
    "sur {s} y a toujours les mêmes intox qui tournent, c'est {r}",
    "{r}. les trucs sur {s} c'est jamais ce qu'on croit",
    "j'ai vu un reportage sur {s}, c'est {r} je vous dis",
    "{r}, tout le monde se trompe sur {s}",
    "attends {s} ? bah c'est {r} évidemment",
    "{r}. mon oncle est calé sur {s}, il m'a expliqué",
    "chaque fois qu'on parle de {s} c'est du pipeau, {r}",
    "{r}, j'avais lu un truc sur {s} qui disait exactement ça",
  ];

  private static readonly MEUBLAGE = [
    'mouais',
    'chelou ce truc',
    "j'hésite grave là",
    'bon bah on verra bien',
    'ça sent le piège',
    'perso je passe mon tour',
    'attendez je regarde encore',
    'ah non mais là aucune idée',
    'vous êtes sûrs de vous vous',
    'jsp du tout franchement',
    'ça se joue à pile ou face',
    'jvais suivre le groupe tiens',
    'bon allez au feeling',
    'jaime pas cette manche',
    'mon wifi rame en plus',
    'quelqu un a compris quelque chose ?',
  ];

  private static readonly RIPOSTES = [
    'mais oui je te dis, fais moi confiance',
    'jsuis sûr de moi là-dessus, tu verras à la révélation',
    "cherche un peu, c'est partout sur internet",
    'après si tu veux pas me croire tant pis pour toi',
    "j'ai plus le lien mais je l'avais lu quelque part",
    'franchement ça se voit gros comme une maison',
    'tu paries combien ?',
    'jvais pas me répéter non plus',
    'de toute façon on saura vite qui avait raison',
    'mon avis est fait, à toi de voir',
    "c'est toi qui vois hein, moi je dis ce que je pense",
    "j'ai un doute d'un coup... non en fait non",
  ];

  private static readonly ESQUIVES = [
    'moi jsais pas hein, me demandez pas',
    'aucune idée désolé',
    "j'ai rien suivi là",
    'demande aux autres plutôt',
    'jvous suis, jai pas d avis',
  ];

  private static readonly APPUIS = [
    '+1 avec {a}',
    '{a} a raison je pense',
    'ouais {a} ça se tient',
    'jsuis {a} là-dessus',
    'comme {a} du coup',
    'bon bah si {a} le dit',
  ];

  private static readonly CONTRADICTIONS = [
    "{a} n'importe quoi, c'est {r} oui",
    '{a} t as regardé la même vidéo que moi ? {r}',
    'attends {a} tu confonds avec autre chose là',
    '{a} tu dis ça à chaque manche',
    'pas du tout {a}, {r} clairement',
    '{a} mdr non, {r}',
    'alors là {a} je suis pas du tout d accord, {r}',
  ];

  private static readonly SUJETS: Array<[RegExp, string]> = [
    [/foudre|éclair|orage|tonnerre/i, 'la foudre'],
    [/plante|feuille|mimosa/i, 'les plantes'],
    [/méduse|piqûre/i, 'les méduses'],
    [/bulle de savon|savon/i, 'les bulles de savon'],
    [/azote liquide|-196|LED/i, "l'azote liquide"],
    [/tesla|courant continu|courant alternatif/i, 'Tesla'],
    [/hindenburg|dirigeable|hélium/i, 'le Hindenburg'],
    [/apollo|lune|lunaire|alunissage/i, 'les missions Apollo'],
    [/soufre|thermochrom/i, 'la chimie'],
    [/oxygène|air que nous respirons/i, "l'air qu'on respire"],
    [/sucre|phosphoresc/i, 'les trucs qui brillent dans le noir'],
    [/insecte|bioluminesc|luciol/i, 'les insectes lumineux'],
    [/tornade/i, 'les tornades'],
    [/avalanche/i, 'les avalanches'],
    [/geyser/i, 'les geysers'],
    [/volcan|éruption|vésuve/i, 'les volcans'],
    [/baleine/i, 'les baleines'],
    [/séisme|tremblement/i, 'les séismes'],
    [/éclipse/i, 'les éclipses'],
    [/haute tension|décoller|engin/i, 'ces engins bizarres'],
  ];

  private static sujetDe(texte: string): string | null {
    const trouve = BotsService.SUJETS.find(([motif]) => motif.test(texte));
    return trouve ? trouve[1] : null;
  }

  private static piocher<T>(liste: T[]): T {
    return liste[Math.floor(Math.random() * liste.length)];
  }

  private static creerPioche<T>(source: T[]): () => T {
    let reste: T[] = [];
    return () => {
      if (reste.length === 0) {
        reste = [...source];
        for (let i = reste.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [reste[i], reste[j]] = [reste[j], reste[i]];
        }
      }
      return reste.pop() as T;
    };
  }

  async animer(
    roomId: string,
    roundId: string,
    emettre: (message: { author: string; content: string }) => void,
  ): Promise<void> {
    this.arreter(roomId);

    const round = await this.prisma.round.findUnique({
      where: { id: roundId },
      select: {
        locksAt: true,
        roundClaims: {
          orderBy: { orderIndex: 'asc' },
          select: { claim: { select: { id: true, truthLabel: true, text: true } } },
        },
      },
    });
    if (!round || round.roundClaims.length === 0) return;

    const restant = round.locksAt.getTime() - Date.now();
    if (restant <= 0) return;

    const minuteries: NodeJS.Timeout[] = [];
    const pioches = {
      generique: BotsService.creerPioche(BotsService.CERTITUDES),
      sujet: BotsService.creerPioche(BotsService.CERTITUDES_SUJET),
      meublage: BotsService.creerPioche(BotsService.MEUBLAGE),
      appui: BotsService.creerPioche(BotsService.APPUIS),
      contradiction: BotsService.creerPioche(BotsService.CONTRADICTIONS),
      riposte: BotsService.creerPioche(BotsService.RIPOSTES),
      esquive: BotsService.creerPioche(BotsService.ESQUIVES),
    };

    let comptes = new Map<string, string>();
    try {
      comptes = await this.comptes();
    } catch (error) {
      this.logger.warn(`Comptes bots indisponibles : ${String(error)}`);
    }

    const programmerVote = (pseudo: string, claimId: string, estFake: boolean, delai: number) => {
      const userId = comptes.get(pseudo);
      if (!userId) return;
      minuteries.push(setTimeout(() => {
        void this.prisma.clipVote
          .upsert({
            where: { userId_roundId_claimId: { userId, roundId, claimId } },
            update: { isFake: estFake },
            create: { userId, roundId, claimId, isFake: estFake },
          })
          .catch((error: unknown) => this.logger.warn(`Vote bot refusé : ${String(error)}`));
      }, delai));
    };

    const ambiance = Math.max(2, Math.round(round.roundClaims.length * BotsService.AMBIANCE_PAR_CLIP));
    for (let i = 0; i < ambiance; i += 1) {
      const auteur =
        Math.random() < 0.5
          ? BotsService.BAVARD
          : BotsService.piocher(BotsService.TROMPEURS);
      const contenu =
        Math.random() < 0.25
          ? pioches.appui().replace('{a}', BotsService.piocher(BotsService.TROMPEURS))
          : pioches.meublage();
      minuteries.push(
        setTimeout(() => emettre({ author: auteur, content: contenu }),
          Math.max(2500, (restant / ambiance) * i + Math.random() * 4000)),
      );
    }
    round.roundClaims.forEach(({ claim }, index) => {
      programmerVote(BotsService.BAVARD, claim.id, Math.random() < 0.5,
        Math.max(2000, (restant / round.roundClaims.length) * index + 6000));
    });

    this.minuteries.set(roomId, minuteries);
    this.pioches.set(roomId, pioches);
    this.logger.log(`Bots activés sur ${roomId} (${minuteries.length} actions programmées)`);
  }

  async reagirAuVote(
    roomId: string,
    roundId: string,
    claimId: string,
    joueurDitFake: boolean,
    emettre: (message: { author: string; content: string }) => void,
  ): Promise<void> {
    const pioches = this.pioches.get(roomId);
    if (!pioches) return;

    const auteur = BotsService.piocher(BotsService.TROMPEURS);
    const cle = `${claimId}:${auteur}`;
    const avisSalon = this.avis.get(roomId) ?? new Map<string, string>();
    this.avis.set(roomId, avisSalon);

    const dejaPositionne = avisSalon.has(cle);
    if (dejaPositionne && Math.random() < BotsService.SILENCE_DEJA_POSITIONNE) return;
    if (!dejaPositionne && Math.random() < BotsService.SILENCE_PREMIER_AVIS) return;

    const maintenant = Date.now();
    if (maintenant - (this.dernierMessage.get(roomId) ?? 0) < BotsService.ECART_MESSAGE_MS) return;
    this.dernierMessage.set(roomId, maintenant);

    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      select: { truthLabel: true, text: true },
    });
    if (!claim) return;

    let reponse = avisSalon.get(cle);
    if (!reponse) {
      const ment = Math.random() < 0.75;
      reponse = ment
        ? (claim.truthLabel === 'TRUE' ? 'fake' : 'vrai')
        : (claim.truthLabel === 'TRUE' ? 'vrai' : 'fake');
      avisSalon.set(cle, reponse);
    }

    const sujet = BotsService.sujetDe(claim.text);
    const modele = dejaPositionne
      ? BotsService.piocher(BotsService.RIPOSTES)
      : (sujet && Math.random() < 0.6
          ? pioches.sujet().replace('{s}', sujet)
          : pioches.generique());

    const delai = 900 + Math.random() * 2200;
    const genere = await this.phraseLLM(
      roomId,
      auteur,
      `Le clip affirme : « ${claim.text.slice(0, 300)} ». Tu es convaincu que c'est `
        + `${reponse === 'fake' ? 'une intox' : 'authentique'} et tu le dis au chat, `
        + 'sans jamais prétendre connaître la réponse officielle.',
    );
    const contenu = genere ?? modele.replace('{r}', reponse);

    const minuterie = setTimeout(() => {
      this.noter(roomId, auteur, contenu);
      emettre({ author: auteur, content: contenu });
      if (genere && Math.random() < BotsService.PROBA_REBOND) this.rebondir(roomId, auteur, contenu, emettre);
    }, delai);
    this.minuteries.set(roomId, [...(this.minuteries.get(roomId) ?? []), minuterie]);

    const comptes = this.comptesCache;
    const userId = comptes?.get(auteur);
    if (!userId) return;
    const suite = setTimeout(() => {
      void this.prisma.clipVote
        .upsert({
          where: { userId_roundId_claimId: { userId, roundId, claimId } },
          update: { isFake: reponse === 'fake' },
          create: { userId, roundId, claimId, isFake: reponse === 'fake' },
        })
        .catch((error: unknown) => this.logger.warn(`Vote bot refusé : ${String(error)}`));
    }, delai + 800);
    this.minuteries.set(roomId, [...(this.minuteries.get(roomId) ?? []), suite]);
    void joueurDitFake;
  }

  private async comptes(): Promise<Map<string, string>> {
    if (this.comptesCache) return this.comptesCache;
    const pseudos = [...BotsService.TROMPEURS, BotsService.BAVARD];
    const paires = await Promise.all(pseudos.map(async (pseudo) => {
      const user = await this.prisma.user.upsert({
        where: { email: `${pseudo}@bots.factarena.local` },
        update: {},
        create: {
          email: `${pseudo}@bots.factarena.local`,
          displayName: pseudo,
          role: 'BOT',
        },
        select: { id: true },
      });
      return [pseudo, user.id] as const;
    }));
    this.comptesCache = new Map(paires);
    return this.comptesCache;
  }

  async interpeller(
    roomId: string,
    contenu: string,
    emettre: (message: { author: string; content: string }) => void,
    joueur = 'un joueur',
  ): Promise<boolean> {
    this.noter(roomId, joueur, contenu);
    const normalise = contenu.toLowerCase();
    const cible = [...BotsService.TROMPEURS, BotsService.BAVARD].find((pseudo) =>
      new RegExp(`(^|[^a-z0-9])@?${pseudo}([^a-z0-9]|$)`, 'i').test(normalise),
    );
    if (!cible) return false;

    const pioches = this.pioches.get(roomId);
    const repli = () =>
      cible === BotsService.BAVARD
        ? (pioches?.esquive?.() ?? BotsService.piocher(BotsService.ESQUIVES))
        : (pioches?.riposte?.() ?? BotsService.piocher(BotsService.RIPOSTES));

    const genere = await this.phraseLLM(
      roomId,
      cible,
      `${joueur} vient de t'écrire : « ${contenu} ». Réponds-lui directement, `
        + 'sans changer d\'avis et sans révéler si la vidéo est vraie ou fausse.',
    );
    const reponse = genere ?? repli();

    const minuterie = setTimeout(() => {
      this.noter(roomId, cible, reponse);
      emettre({ author: cible, content: reponse });
      if (genere && Math.random() < BotsService.PROBA_REBOND) this.rebondir(roomId, cible, reponse, emettre);
    }, 1200 + Math.random() * 2500);
    this.minuteries.set(roomId, [...(this.minuteries.get(roomId) ?? []), minuterie]);
    return true;
  }

  private rebondir(
    roomId: string,
    auteurPrecedent: string,
    ditPrecedent: string,
    emettre: (message: { author: string; content: string }) => void,
  ): void {
    const autres = [...BotsService.TROMPEURS, BotsService.BAVARD].filter((p) => p !== auteurPrecedent);
    const bot = BotsService.piocher(autres);
    const minuterie = setTimeout(() => {
      void (async () => {
        const phrase = await this.phraseLLM(
          roomId,
          bot,
          `${auteurPrecedent} vient de dire : « ${ditPrecedent} ». Réagis à lui, `
            + 'en le nommant, pour approuver ou contredire selon ton caractère.',
        );
        if (!phrase) return;
        this.noter(roomId, bot, phrase);
        emettre({ author: bot, content: phrase });
      })();
    }, 2500 + Math.random() * 3500);
    this.minuteries.set(roomId, [...(this.minuteries.get(roomId) ?? []), minuterie]);
  }

  arreter(roomId: string): void {
    this.conversation.delete(roomId);
    const existantes = this.minuteries.get(roomId);
    existantes?.forEach(clearTimeout);
    this.minuteries.delete(roomId);
    this.avis.delete(roomId);
    this.pioches.delete(roomId);
    this.dernierMessage.delete(roomId);
  }
}
