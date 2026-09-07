import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CUID_PATTERN } from '../common/pipes/cuid-param.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { BetsService } from '../bets/bets.service';
import { ClipVotesService } from '../clip-votes/clip-votes.service';
import { RoomPresenceService } from '../rooms/room-presence.service';
import { RoomsService } from '../rooms/rooms.service';
import { RoundsService } from '../rounds/rounds.service';
import { ChatService } from '../chat/chat.service';
import { AiService } from '../ai/ai.service';
import { BotsService } from './bots.service';
import { StatsService } from '../stats/stats.service';
import { LedgerService } from '../ledger/ledger.service';
import { Server, Socket } from 'socket.io';

type AuthenticatedSocket = Socket & { data: { userId: string; email?: string; roomId?: string } };

interface RoomPayload { roomId: string }
interface BetPayload extends RoomPayload {
  roundId: string;
  stake: number;
}
interface ClipVotePayload extends RoomPayload { roundId: string; claimId: string; isFake: boolean }
interface ChatPayload extends RoomPayload {
  content: string;
}

@WebSocketGateway({
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  cors: { origin: false },
})
@Injectable()
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly socketsByUser = new Map<string, Set<string>>();
  // Nettement sous le TTL de 45 s de la présence, pour qu'elle n'expire jamais
  // tant que la socket vit.
  private static readonly BATTEMENT_MS = 20_000;
  private battement?: ReturnType<typeof setInterval>;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly roomPresence: RoomPresenceService,
    @Inject(forwardRef(() => RoomsService)) private readonly roomsService: RoomsService,
    @Inject(forwardRef(() => RoundsService)) private readonly roundsService: RoundsService,
    @Inject(forwardRef(() => BetsService)) private readonly betsService: BetsService,
    private readonly clipVotesService: ClipVotesService,
    @Inject(forwardRef(() => ChatService)) private readonly chatService: ChatService,
    private readonly aiService: AiService,
    private readonly botsService: BotsService,
    private readonly statsService: StatsService,
    @Inject(forwardRef(() => LedgerService)) private readonly ledgerService: LedgerService,
  ) {}

  /** Diffuse les changements de pseudo/avatar à toutes les sessions connectées. */
  broadcastProfileUpdate(user: { id: string; displayName: string | null; avatarUrl: string | null }) {
    this.server?.emit('profile:update', user);
  }

  broadcastRoomListUpdate() {
    this.server?.emit('rooms:update');
  }

  broadcastHistoryUpdate() {
    this.server?.emit('history:update');
  }

  async broadcastBalanceUpdate(userId: string) {
    const balance = await this.ledgerService.getBalance(userId);
    for (const socketId of this.socketsByUser.get(userId) ?? []) {
      this.server?.to(socketId).emit('balance:update', { userId, virtualBalance: balance.virtualBalance });
    }
  }

  notifyFriendUpdate(userId: string, update: { type: string; requestId?: string; friendId?: string }) {
    for (const socketId of this.socketsByUser.get(userId) ?? []) {
      this.server?.to(socketId).emit('friend:update', update);
    }
  }

  private async broadcastLeaderboardUpdate() {
    if (this.server) this.server.emit('leaderboard:update', await this.statsService.getLeaderboard());
  }

  async handleConnection(rawSocket: Socket) {
    const socket = rawSocket as AuthenticatedSocket;
    try {
      const token = this.readToken(socket);
      const payload = this.jwtService.verify<{ sub?: string; email?: string }>(token);
      if (!payload.sub) throw new UnauthorizedException('Le jeton ne contient aucun sujet');

      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true } });
      if (!user) throw new UnauthorizedException('Utilisateur introuvable');

      socket.data.userId = user.id;
      socket.data.email = user.email;
      this.addSocket(user.id, socket.id);
      await this.prisma.user.update({ where: { id: user.id }, data: { status: 'ONLINE' } });

      socket.emit('connection:ready', { userId: user.id, socketId: socket.id });
      this.broadcastPresence(user.id, 'ONLINE');
      // Un nouveau joueur peut venir d’être inscrit : son arrivée doit
      // actualiser le classement affiché sur les pages Profil déjà ouvertes.
      await this.broadcastLeaderboardUpdate();
      const roomId = socket.handshake.auth?.roomId;
      if (typeof roomId === 'string' && roomId.length > 0) {
        // Un salon disparu ne doit pas emporter la connexion avec lui. Sans ce
        // filet, l'exception remontait au catch ci-dessous, qui fermait le
        // socket en annonçant un échec d'authentification : le client rouvrait,
        // échouait de nouveau, et restait sur « connexion en cours » sans fin.
        try {
          await this.restoreRoom(socket, roomId);
        } catch (error) {
          this.logger.debug(`Salon ${roomId} non restauré: ${String(error)}`);
          socket.emit('room:error', { message: this.messageSalonInaccessible(error) });
        }
      }
      this.logger.debug(`WebSocket connected: ${socket.id} (${user.id})`);
    } catch (error) {
      this.logger.debug(`Rejected WebSocket connection: ${socket.id}`);
      socket.emit('error', { code: 'UNAUTHORIZED', message: 'Authentification requise' });
      socket.disconnect(true);
      if (error instanceof UnauthorizedException) return;
    }
  }

  // Sans ce battement, la présence d'un joueur qui regarde sans agir expirait
  // au bout de 45 s : il restait connecté mais n'était plus membre, et ses
  // messages comme ses votes étaient refusés sans que rien ne l'indique.
  onModuleInit() {
    this.battement = setInterval(() => { void this.rafraichirPresences(); }, RealtimeGateway.BATTEMENT_MS);
  }

  onModuleDestroy() {
    if (this.battement) clearInterval(this.battement);
  }

  private async rafraichirPresences() {
    if (!this.server) return;
    try {
      const entrees = [...this.server.sockets.sockets.values()]
        .map((socket) => socket as AuthenticatedSocket)
        .filter((socket) => socket.data?.userId && socket.data?.roomId)
        .map((socket) => ({ socketId: socket.id, userId: socket.data.userId, roomId: socket.data.roomId as string }));
      if (entrees.length > 0) await this.roomPresence.rafraichir(entrees);
    } catch (error) {
      this.logger.warn(`Rafraîchissement des présences échoué: ${(error as Error).message}`);
    }
  }

  // Socket.IO ne surveille pas la promesse renvoyée : une erreur qui s'échappe
  // d'ici devient un rejet non capturé et arrête le process.
  async handleDisconnect(rawSocket: Socket) {
    try {
      await this.nettoyerDeconnexion(rawSocket as AuthenticatedSocket);
    } catch (error) {
      this.logger.warn(`Nettoyage de déconnexion incomplet: ${(error as Error).message}`);
    }
  }

  private async nettoyerDeconnexion(socket: AuthenticatedSocket) {
    const userId = socket.data.userId;
    if (!userId) return;

    this.removeSocket(userId, socket.id);
    const leftPresence = await this.roomPresence.leave(socket.id);
    if (leftPresence?.leftRoom) {
      this.server.to(this.roomChannel(leftPresence.roomId)).emit('room:member_left', { userId });
      this.server.to(this.roomChannel(leftPresence.roomId)).emit('room:state', await this.roomsService.getState(leftPresence.roomId));
    }
    if (!this.socketsByUser.has(userId)) {
      await this.prisma.user.updateMany({ where: { id: userId }, data: { status: 'OFFLINE' } });
      this.broadcastPresence(userId, 'OFFLINE');
    } else {
      const inRoom = await this.roomPresence.getCurrentRoomId(userId);
      await this.prisma.user.updateMany({ where: { id: userId }, data: { status: inRoom ? 'IN_GAME' : 'ONLINE' } });
    }
    this.logger.debug(`WebSocket disconnected: ${socket.id} (${userId})`);
  }

  /** Ce qu'on dit au joueur quand un salon ne peut pas être rejoint. */
  private messageSalonInaccessible(error: unknown): string {
    return error instanceof NotFoundException || error instanceof BadRequestException
      ? 'Ce salon n’existe plus. Retourne au lobby pour en choisir un autre.'
      : 'Impossible de rejoindre ce salon.';
  }

  @SubscribeMessage('room:join')
  async joinRoom(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: RoomPayload) {
    let room: Awaited<ReturnType<RoomsService['findOne']>>;
    try {
      this.assertCuid(body?.roomId, 'roomId');
      room = await this.roomsService.findOne(body?.roomId);
    } catch (error) {
      // Même raison qu'à la connexion : l'exception partait dans un événement
      // « exception » que le client n'écoute pas.
      const message = this.messageSalonInaccessible(error);
      socket.emit('room:error', { message });
      return { rejected: true, message };
    }
    if (socket.data.roomId) await socket.leave(this.roomChannel(socket.data.roomId));
    let presence: Awaited<ReturnType<RoomPresenceService['join']>>;
    try {
      presence = await this.roomPresence.join(socket.id, socket.data.userId, room.id);
    } catch (error) {
      if (error instanceof ConflictException) {
        socket.emit('room:error', { message: error.message });
        return { rejected: true, message: error.message };
      }
      throw error;
    }
    socket.data.roomId = room.id;
    await socket.join(this.roomChannel(room.id));
    await this.prisma.user.update({ where: { id: socket.data.userId }, data: { status: 'IN_GAME' } });
    this.broadcastPresence(socket.data.userId, 'IN_GAME', room.id);

    if (presence.previousRoomId && presence.previousRoomId !== room.id) {
      this.server.to(this.roomChannel(presence.previousRoomId)).emit('room:member_left', { userId: socket.data.userId });
      this.server.to(this.roomChannel(presence.previousRoomId)).emit('room:state', await this.roomsService.getState(presence.previousRoomId));
    }

    const state = await this.roomsService.getState(room.id);
    socket.emit('room:joined', state);
    if (presence.joinedRoom) socket.to(this.roomChannel(room.id)).emit('room:member_joined', { userId: socket.data.userId });
    this.server.to(this.roomChannel(room.id)).emit('room:state', state);
    return state;
  }

  @SubscribeMessage('room:leave')
  async leaveRoom(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body?: RoomPayload) {
    const roomId = body?.roomId || socket.data.roomId;
    if (!roomId) return { roomId: null };
    this.assertCuid(roomId, 'roomId');
    await socket.leave(this.roomChannel(roomId));
    if (socket.data.roomId === roomId) delete socket.data.roomId;
    const leftPresence = await this.roomPresence.leave(socket.id);
    const currentRoom = await this.roomPresence.getCurrentRoomId(socket.data.userId);
    await this.prisma.user.updateMany({ where: { id: socket.data.userId }, data: { status: currentRoom ? 'IN_GAME' : 'ONLINE' } });
    this.broadcastPresence(socket.data.userId, currentRoom ? 'IN_GAME' : 'ONLINE', currentRoom);
    if (leftPresence?.leftRoom) this.server.to(this.roomChannel(roomId)).emit('room:member_left', { userId: socket.data.userId });
    this.server.to(this.roomChannel(roomId)).emit('room:state', await this.roomsService.getState(roomId));
    return { roomId };
  }

  @SubscribeMessage('room:state')
  async getRoomState(@MessageBody() body: RoomPayload) {
    this.assertCuid(body?.roomId, 'roomId');
    return this.roomsService.getState(body?.roomId);
  }

  @SubscribeMessage('bet:place')
  async placeBet(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: BetPayload) {
    this.assertCuid(body?.roomId, 'roomId');
    this.assertCuid(body?.roundId, 'roundId');
    this.assertPositiveInteger(body?.stake, 'stake');
    await this.assertInRoom(socket, body.roomId);
    await this.roundsService.assertBelongsToRoom(body.roundId, body.roomId);
    const bet = await this.betsService.create({
      roundId: body.roundId,
      stake: body.stake,
    }, socket.data.userId);
    await this.broadcastBalanceUpdate(socket.data.userId);
    const state = await this.roomsService.getState(body.roomId);
    this.server.to(this.roomChannel(body.roomId)).emit('bet:updated', { bet, ...this.liveStats(state) });
    // Le front tient son état des événements room:state / round:* uniquement.
    // Sans cette diffusion, le pot restait affiché à sa valeur d'avant la mise.
    this.server.to(this.roomChannel(body.roomId)).emit('room:state', state);
    return bet;
  }

  @SubscribeMessage('clip-vote:submit')
  async submitClipVote(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: ClipVotePayload) {
    this.assertCuid(body?.roomId, 'roomId'); this.assertCuid(body?.roundId, 'roundId'); this.assertCuid(body?.claimId, 'claimId');
    if (typeof body?.isFake !== 'boolean') throw new BadRequestException('Le champ isFake est invalide');
    await this.assertInRoom(socket, body.roomId); await this.roundsService.assertBelongsToRoom(body.roundId, body.roomId);
    const vote = await this.clipVotesService.create({ roundId: body.roundId, claimId: body.claimId, isFake: body.isFake }, socket.data.userId);
    this.server.to(this.roomChannel(body.roomId)).emit('clip-vote:updated', vote);
    // Les faux joueurs rebondissent sur le vote qui vient d'être émis, plutôt
    // que sur une horloge : c'est le seul moyen qu'ils commentent le clip que
    // le joueur regarde vraiment, puisque chacun avance à son rythme.
    if (!(vote as { alreadyVoted?: boolean }).alreadyVoted) {
      void this.botsService.reagirAuVote(body.roomId, body.roundId, body.claimId, body.isFake, (m) =>
        this.diffuserMessageBot(body.roomId, m),
      );
    }
    return vote;
  }

  /**
   * Un joueur signale un clip dont la vidéo ne correspond pas à l'affirmation.
   *
   * Le corpus étant constitué automatiquement, quelques rattachements sont
   * mauvais et les joueurs les repèrent avant nous. On enregistre sans rien
   * diffuser : un signalement visible influencerait le vote des autres.
   */
  @SubscribeMessage('clip:report')
  async reportClip(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: RoomPayload & { claimId: string; roundId?: string; reason?: string }) {
    this.assertCuid(body?.roomId, 'roomId');
    this.assertCuid(body?.claimId, 'claimId');
    if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 300)) {
      throw new BadRequestException('Motif invalide');
    }
    await this.assertInRoom(socket, body.roomId);
    // upsert plutôt que create : recliquer ne doit ni gonfler le compteur ni
    // renvoyer une erreur au joueur, qui n'y comprendrait rien.
    await this.prisma.clipReport.upsert({
      where: { userId_claimId: { userId: socket.data.userId, claimId: body.claimId } },
      update: { reason: body.reason ?? null },
      create: {
        userId: socket.data.userId,
        claimId: body.claimId,
        roundId: body.roundId ?? null,
        reason: body.reason ?? null,
      },
    });
    return { signale: true };
  }

  @SubscribeMessage('round:lock')
  async lockRound(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: RoomPayload & { roundId: string }) {
    this.assertCuid(body?.roomId, 'roomId');
    this.assertCuid(body?.roundId, 'roundId');
    await this.assertInRoom(socket, body.roomId);
    await this.roundsService.assertBelongsToRoom(body.roundId, body.roomId);
    const round = await this.roundsService.lock(body.roundId, socket.data.userId);
    const state = await this.roomsService.getState(body.roomId);
    this.server.to(this.roomChannel(body.roomId)).emit('round:locked', { round, ...this.liveStats(state) });
    this.server.to(this.roomChannel(body.roomId)).emit('round:state', state);
    return round;
  }

  @SubscribeMessage('round:reveal')
  async revealRound(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: RoomPayload & { roundId: string }) {
    this.assertCuid(body?.roomId, 'roomId');
    this.assertCuid(body?.roundId, 'roundId');
    await this.assertInRoom(socket, body.roomId);
    await this.roundsService.assertBelongsToRoom(body.roundId, body.roomId);
    const round = await this.roundsService.reveal(body.roundId, socket.data.userId);
    const state = await this.roomsService.getState(body.roomId);
    this.server.to(this.roomChannel(body.roomId)).emit('round:revealed', { round, ...this.liveStats(state) });
    this.server.to(this.roomChannel(body.roomId)).emit('round:state', state);
    return round;
  }

  @SubscribeMessage('chat:send')
  async sendChatMessage(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: ChatPayload) {
    this.assertCuid(body?.roomId, 'roomId');
    if (typeof body?.content !== 'string' || body.content.length === 0 || body.content.length > 1000) {
      throw new BadRequestException('Contenu invalide');
    }
    await this.assertInRoom(socket, body.roomId);
    const botPrompt = body.content.replace(/^\s*(?:@bot|\/ask)\s*/i, '').trim();
    const questionAuBot = botPrompt !== body.content.trim() && botPrompt.length > 0;

    // Une question au bot part d'abord dans le salon comme n'importe quel
    // message. Elle était jusqu'ici avalée : on voyait la réponse sans la
    // question, et les autres joueurs ne voyaient qu'un monologue. Passer par
    // le même chemin la soumet aussi à la modération.
    const message = await this.chatService.sendMessage(socket.data.userId, body.roomId, body.content);
    // Message supprimé par la modération : rien ne part dans le salon, mais on
    // prévient son auteur. Sans ça il tapait, envoyait, et il ne se passait
    // rien — de quoi croire le chat cassé plutôt que d'y voir une sanction.
    if (message.action === 'delete') {
      socket.emit('chat:moderated', { reason: 'Message bloqué par la modération.' });
      return message;
    }
    this.server.to(this.roomChannel(body.roomId)).emit('chat:message', message);

    if (questionAuBot) {
      try {
        for await (const event of this.chatService.streamBot(socket.data.userId, body.roomId, botPrompt)) socket.emit(`ai:${event.type}`, event.data);
        return { action: 'bot' };
      } catch (error) {
        socket.emit('ai:error', { message: error instanceof Error ? error.message : 'La requête du bot a échoué' });
        throw error;
      }
    }

    // Si le joueur a nommé un des faux joueurs, celui-ci répond. Diffusé après
    // le message d'origine pour que l'ordre d'affichage reste cohérent. Une
    // question adressée au bot ne les concerne pas.
    void this.botsService.interpeller(
      body.roomId,
      body.content,
      (m) => this.diffuserMessageBot(body.roomId, m),
      socket.data.email?.split('@')[0],
    );
    return message;
  }

  @SubscribeMessage('ai:chat')
  async streamAiChat(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: { prompt?: string; roomId?: string }) {
    if (typeof body?.prompt !== 'string' || body.prompt.trim().length === 0 || body.prompt.length > 4000) {
      throw new BadRequestException('Invite invalide');
    }
    if (body.roomId) await this.assertInRoom(socket, body.roomId);

    // On passait par streamChat (/llm/chat), qui répond SANS source : le bot
    // n'a jamais démontré le module RAG. Et un refus global pendant la manche
    // le rendait muet sur tout, y compris les questions de méthode — alors que
    // guardrail.py sait précisément distinguer les deux. On lui donne donc les
    // clips en jeu et on le laisse trancher.
    const activeRound = body.roomId ? (await this.roomsService.getState(body.roomId)).round : null;
    const enJeu = activeRound && ['COUNTDOWN', 'OPEN', 'LOCKED'].includes(String(activeRound.status));
    const enCours = enJeu
      ? ((activeRound as {
          roundClaims?: Array<{ claim?: { text?: string; sourceUrl?: string | null } }>;
        }).roundClaims ?? []).map((rc) => rc.claim)
      : [];
    const claims = enCours.map((c) => c?.text).filter((t): t is string => typeof t === 'string');
    // Les articles qui ont établi le verdict des clips en jeu sont écartés de la
    // recherche : sans ça, une question sur le sujet ramène le débunk et donne
    // la réponse.
    const exclureUrls = enCours
      .map((c) => c?.sourceUrl)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);

    try {
      for await (const event of this.aiService.streamRag(body.prompt, socket.data.userId, {
        claims,
        exclureUrls,
      })) {
        socket.emit(`ai:${event.type}`, event.data);
      }
      return { success: true };
    } catch (error) {
      socket.emit('ai:error', { message: 'La diffusion IA a échoué' });
      throw error;
    }
  }

  /**
   * Diffuse un message d'un faux joueur dans le chat d'un salon.
   *
   * Le format imite exactement celui d'un vrai message (enveloppe
   * { action, message }) pour que le front n'ait aucun cas particulier à
   * traiter. Mais rien n'est écrit en base et la modération n'est pas
   * sollicitée : ces messages sont éphémères, ils animent la manche et
   * disparaissent. Ils ne doivent pas polluer l'historique du salon.
   */
  diffuserMessageBot(roomId: string, message: { author: string; content: string }): void {
    this.server.to(this.roomChannel(roomId)).emit('chat:message', {
      action: 'allow',
      message: {
        id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content: message.content,
        createdAt: new Date().toISOString(),
        // On expose un pseudo d'apparence ordinaire : côté joueur, rien ne
        // distingue ces intervenants des autres participants (c'est le but).
        user: { email: `${message.author}@factarena.local` },
      },
    });
  }

  /** Used by the server game loop to publish transitions that were not caused by a client event. */
  async publishRoundState(roomId: string, event: string, roundId?: string) {
    const state = await this.roomsService.getState(roomId, roundId);
    this.server.to(this.roomChannel(roomId)).emit(event, state);
    this.server.to(this.roomChannel(roomId)).emit('round:state', state);
    if (event === 'round:revealed' || event === 'round:finished') {
      await Promise.all(state.members.map((member: { id: string }) => this.broadcastBalanceUpdate(member.id)));
    }
    return state;
  }

  async publishRoundVerdicts(roomId: string, roundId: string, verdicts: unknown[], classement: unknown[] = []) {
    this.server.to(this.roomChannel(roomId)).emit('round:verdicts', { roundId, verdicts, classement });
    await this.broadcastLeaderboardUpdate();
    this.broadcastHistoryUpdate();
  }

  private liveStats(state: { pot: number; betCount: number }) {
    return {
      pot: state.pot,
      betCount: state.betCount,
    };
  }

  private async assertInRoom(socket: AuthenticatedSocket, roomId: string) {
    if (!roomId || socket.data.roomId !== roomId) throw new UnauthorizedException('Rejoignez d’abord le salon');
    await this.roomPresence.touch(socket.id);
    await this.roomsService.findOne(roomId);
  }

  private async restoreRoom(socket: AuthenticatedSocket, roomId: string) {
    this.assertCuid(roomId, 'roomId');
    const room = await this.roomsService.findOne(roomId);
    socket.data.roomId = room.id;
    await socket.join(this.roomChannel(room.id));
    await this.roomPresence.join(socket.id, socket.data.userId, room.id);
    await this.prisma.user.update({ where: { id: socket.data.userId }, data: { status: 'IN_GAME' } });
    this.broadcastPresence(socket.data.userId, 'IN_GAME', room.id);
    const state = await this.roomsService.getState(room.id);
    socket.emit('room:reconnected', state);
    return state;
  }

  private readToken(socket: Socket) {
    const authToken = socket.handshake.auth?.token;
    const header = socket.handshake.headers.authorization;
    const token = authToken || (typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : undefined);
    if (!token || typeof token !== 'string') throw new UnauthorizedException('Jeton WebSocket manquant');
    return token;
  }

  private roomChannel(roomId: string) { return `room:${roomId}`; }

  private addSocket(userId: string, socketId: string) {
    const sockets = this.socketsByUser.get(userId) || new Set<string>();
    sockets.add(socketId);
    this.socketsByUser.set(userId, sockets);
  }

  private removeSocket(userId: string, socketId: string) {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) this.socketsByUser.delete(userId);
  }

  private broadcastPresence(userId: string, status: 'ONLINE' | 'OFFLINE' | 'IN_GAME', currentRoomId: string | null = null) {
    this.server.emit('presence:update', { userId, status, currentRoomId });
  }

  private assertCuid(value: unknown, fieldName: string) {
    if (typeof value !== 'string' || !CUID_PATTERN.test(value)) {
      throw new BadRequestException(`${fieldName} invalide`);
    }
  }

  private assertPositiveInteger(value: unknown, fieldName: string) {
    if (!Number.isInteger(value) || Number(value) < 1) {
      throw new BadRequestException(`${fieldName} invalide`);
    }
  }

  private assertNonNegativeInteger(value: unknown, fieldName: string) {
    if (!Number.isInteger(value) || Number(value) < 0) {
      throw new BadRequestException(`${fieldName} invalide`);
    }
  }
}
