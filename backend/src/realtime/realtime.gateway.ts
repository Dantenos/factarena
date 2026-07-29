import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { PredictionsService } from '../predictions/predictions.service';
import { RoomsService } from '../rooms/rooms.service';
import { RoundsService } from '../rounds/rounds.service';
import { Server, Socket } from 'socket.io';

type AuthenticatedSocket = Socket & { data: { userId: string; email?: string; roomId?: string } };

interface RoomPayload { roomId: string }
interface PredictionPayload extends RoomPayload {
  roundId: string;
  predictedFakeCount: number;
  stake: number;
}

@WebSocketGateway({
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  cors: { origin: false },
})
@Injectable()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly socketsByUser = new Map<string, Set<string>>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly roomsService: RoomsService,
    private readonly roundsService: RoundsService,
    private readonly predictionsService: PredictionsService,
  ) {}

  async handleConnection(rawSocket: Socket) {
    const socket = rawSocket as AuthenticatedSocket;
    try {
      const token = this.readToken(socket);
      const payload = this.jwtService.verify<{ sub?: string; email?: string }>(token);
      if (!payload.sub) throw new UnauthorizedException('Token has no subject');

      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true } });
      if (!user) throw new UnauthorizedException('User not found');

      socket.data.userId = user.id;
      socket.data.email = user.email;
      this.addSocket(user.id, socket.id);
      await this.prisma.user.update({ where: { id: user.id }, data: { status: 'ONLINE' } });

      socket.emit('connection:ready', { userId: user.id, socketId: socket.id });
      this.broadcastPresence(user.id, 'ONLINE');
      const roomId = socket.handshake.auth?.roomId;
      if (typeof roomId === 'string' && roomId.length > 0) {
        await this.restoreRoom(socket, roomId);
      }
      this.logger.debug(`WebSocket connected: ${socket.id} (${user.id})`);
    } catch (error) {
      this.logger.debug(`Rejected WebSocket connection: ${socket.id}`);
      socket.emit('error', { code: 'UNAUTHORIZED', message: 'Authentication required' });
      socket.disconnect(true);
      if (error instanceof UnauthorizedException) return;
    }
  }

  async handleDisconnect(rawSocket: Socket) {
    const socket = rawSocket as AuthenticatedSocket;
    const userId = socket.data.userId;
    if (!userId) return;

    this.removeSocket(userId, socket.id);
    if (!this.socketsByUser.has(userId)) {
      await this.prisma.user.updateMany({ where: { id: userId }, data: { status: 'OFFLINE' } });
      this.broadcastPresence(userId, 'OFFLINE');
    }
    this.logger.debug(`WebSocket disconnected: ${socket.id} (${userId})`);
  }

  @SubscribeMessage('room:join')
  async joinRoom(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: RoomPayload) {
    const room = await this.roomsService.findOne(body?.roomId);
    if (socket.data.roomId) await socket.leave(this.roomChannel(socket.data.roomId));
    socket.data.roomId = room.id;
    await socket.join(this.roomChannel(room.id));
    await this.prisma.user.update({ where: { id: socket.data.userId }, data: { status: 'IN_GAME' } });

    const state = await this.roomState(room.id);
    socket.emit('room:joined', state);
    socket.to(this.roomChannel(room.id)).emit('room:member_joined', { userId: socket.data.userId });
    this.server.to(this.roomChannel(room.id)).emit('room:state', state);
    return state;
  }

  @SubscribeMessage('room:leave')
  async leaveRoom(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body?: RoomPayload) {
    const roomId = body?.roomId || socket.data.roomId;
    if (!roomId) return { roomId: null };
    await socket.leave(this.roomChannel(roomId));
    if (socket.data.roomId === roomId) delete socket.data.roomId;
    await this.prisma.user.updateMany({ where: { id: socket.data.userId }, data: { status: 'ONLINE' } });
    this.server.to(this.roomChannel(roomId)).emit('room:member_left', { userId: socket.data.userId });
    return { roomId };
  }

  @SubscribeMessage('room:state')
  async getRoomState(@MessageBody() body: RoomPayload) {
    return this.roomState(body?.roomId);
  }

  @SubscribeMessage('prediction:submit')
  async submitPrediction(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: PredictionPayload) {
    await this.assertInRoom(socket, body.roomId);
    const prediction = await this.predictionsService.create({
      roundId: body.roundId,
      predictedFakeCount: body.predictedFakeCount,
      stake: body.stake,
    }, socket.data.userId);
    const state = await this.roomState(body.roomId);
    this.server.to(this.roomChannel(body.roomId)).emit('prediction:updated', { prediction, ...this.liveStats(state) });
    return prediction;
  }

  @SubscribeMessage('round:lock')
  async lockRound(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: RoomPayload & { roundId: string }) {
    await this.assertInRoom(socket, body.roomId);
    const round = await this.roundsService.lock(body.roundId, socket.data.userId);
    const state = await this.roomState(body.roomId);
    this.server.to(this.roomChannel(body.roomId)).emit('round:locked', { round, ...this.liveStats(state) });
    this.server.to(this.roomChannel(body.roomId)).emit('round:state', state);
    return round;
  }

  @SubscribeMessage('round:reveal')
  async revealRound(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: RoomPayload & { roundId: string }) {
    await this.assertInRoom(socket, body.roomId);
    const round = await this.roundsService.reveal(body.roundId, socket.data.userId);
    const state = await this.roomState(body.roomId);
    this.server.to(this.roomChannel(body.roomId)).emit('round:revealed', { round, ...this.liveStats(state) });
    this.server.to(this.roomChannel(body.roomId)).emit('round:state', state);
    return round;
  }

  /** Used by the server game loop to publish transitions that were not caused by a client event. */
  async publishRoundState(roomId: string, event: string, roundId?: string) {
    const state = await this.roomState(roomId, roundId);
    this.server.to(this.roomChannel(roomId)).emit(event, state);
    this.server.to(this.roomChannel(roomId)).emit('round:state', state);
    return state;
  }

  private async roomState(roomId: string, requestedRoundId?: string) {
    const room = await this.roomsService.findOne(roomId);
    const activeRound = room.rounds.find((candidate) => ['COUNTDOWN', 'OPEN', 'LOCKED', 'REVEALED'].includes(candidate.status));
    const round = requestedRoundId
      ? await this.roundsService.findOne(requestedRoundId)
      : activeRound ? await this.roundsService.findOne(activeRound.id) : null;
    const predictions = round ? await this.predictionsService.findByRound(round.id) : [];
    return {
      room: { id: room.id, name: room.name, status: room.status, createdBy: room.createdBy },
      round,
      ...this.liveStats({ round, predictions }),
      serverTime: new Date().toISOString(),
    };
  }

  private liveStats(state: { round?: { id: string } | null; predictions?: Array<{ stake: number; predictedFakeCount: number }> }) {
    const predictions = state.predictions || [];
    const pot = predictions.reduce((total, prediction) => total + prediction.stake, 0);
    const distribution = predictions.reduce<Record<string, number>>((result, prediction) => {
      const key = String(prediction.predictedFakeCount);
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {});
    return { pot, predictionCount: predictions.length, distribution };
  }

  private async assertInRoom(socket: AuthenticatedSocket, roomId: string) {
    if (!roomId || socket.data.roomId !== roomId) throw new UnauthorizedException('Join the room first');
    await this.roomsService.findOne(roomId);
  }

  private async restoreRoom(socket: AuthenticatedSocket, roomId: string) {
    const room = await this.roomsService.findOne(roomId);
    socket.data.roomId = room.id;
    await socket.join(this.roomChannel(room.id));
    await this.prisma.user.update({ where: { id: socket.data.userId }, data: { status: 'IN_GAME' } });
    const state = await this.roomState(room.id);
    socket.emit('room:reconnected', state);
    return state;
  }

  private readToken(socket: Socket) {
    const authToken = socket.handshake.auth?.token;
    const header = socket.handshake.headers.authorization;
    const token = authToken || (typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : undefined);
    if (!token || typeof token !== 'string') throw new UnauthorizedException('Missing WebSocket token');
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

  private broadcastPresence(userId: string, status: 'ONLINE' | 'OFFLINE') {
    this.server.emit('presence:update', { userId, status });
  }
}
