import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CUID_PATTERN } from '../common/pipes/cuid-param.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { PredictionsService } from '../predictions/predictions.service';
import { RoomPresenceService } from '../rooms/room-presence.service';
import { RoomsService } from '../rooms/rooms.service';
import { RoundsService } from '../rounds/rounds.service';
import { ChatService } from '../chat/chat.service';
import { AiService } from '../ai/ai.service';
import { Server, Socket } from 'socket.io';

type AuthenticatedSocket = Socket & { data: { userId: string; email?: string; roomId?: string } };

interface RoomPayload { roomId: string }
interface PredictionPayload extends RoomPayload {
  roundId: string;
  predictedFakeCount: number;
  stake: number;
}
interface ChatPayload extends RoomPayload {
  content: string;
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
    private readonly roomPresence: RoomPresenceService,
    private readonly roomsService: RoomsService,
    private readonly roundsService: RoundsService,
    private readonly predictionsService: PredictionsService,
    private readonly chatService: ChatService,
    private readonly aiService: AiService,
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

  @SubscribeMessage('room:join')
  async joinRoom(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: RoomPayload) {
    this.assertCuid(body?.roomId, 'roomId');
    const room = await this.roomsService.findOne(body?.roomId);
    if (socket.data.roomId) await socket.leave(this.roomChannel(socket.data.roomId));
    socket.data.roomId = room.id;
    await socket.join(this.roomChannel(room.id));
    const presence = await this.roomPresence.join(socket.id, socket.data.userId, room.id);
    await this.prisma.user.update({ where: { id: socket.data.userId }, data: { status: 'IN_GAME' } });

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
    if (leftPresence?.leftRoom) this.server.to(this.roomChannel(roomId)).emit('room:member_left', { userId: socket.data.userId });
    this.server.to(this.roomChannel(roomId)).emit('room:state', await this.roomsService.getState(roomId));
    return { roomId };
  }

  @SubscribeMessage('room:state')
  async getRoomState(@MessageBody() body: RoomPayload) {
    this.assertCuid(body?.roomId, 'roomId');
    return this.roomsService.getState(body?.roomId);
  }

  @SubscribeMessage('prediction:submit')
  async submitPrediction(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: PredictionPayload) {
    this.assertCuid(body?.roomId, 'roomId');
    this.assertCuid(body?.roundId, 'roundId');
    this.assertNonNegativeInteger(body?.predictedFakeCount, 'predictedFakeCount');
    this.assertPositiveInteger(body?.stake, 'stake');
    await this.assertInRoom(socket, body.roomId);
    const prediction = await this.predictionsService.create({
      roundId: body.roundId,
      predictedFakeCount: body.predictedFakeCount,
      stake: body.stake,
    }, socket.data.userId);
    const state = await this.roomsService.getState(body.roomId);
    this.server.to(this.roomChannel(body.roomId)).emit('prediction:updated', { prediction, ...this.liveStats(state) });
    return prediction;
  }

  @SubscribeMessage('round:lock')
  async lockRound(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: RoomPayload & { roundId: string }) {
    this.assertCuid(body?.roomId, 'roomId');
    this.assertCuid(body?.roundId, 'roundId');
    await this.assertInRoom(socket, body.roomId);
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
      throw new BadRequestException('Invalid content');
    }
    await this.assertInRoom(socket, body.roomId);
    const message = await this.chatService.sendMessage(socket.data.userId, body.roomId, body.content);
    this.server.to(this.roomChannel(body.roomId)).emit('chat:message', message);
    return message;
  }

  @SubscribeMessage('ai:chat')
  async streamAiChat(@ConnectedSocket() socket: AuthenticatedSocket, @MessageBody() body: { prompt?: string }) {
    if (typeof body?.prompt !== 'string' || body.prompt.trim().length === 0 || body.prompt.length > 4000) {
      throw new BadRequestException('Invalid prompt');
    }
    try {
      for await (const event of this.aiService.streamChat(body.prompt, socket.data.userId)) {
        socket.emit(`ai:${event.type}`, event.data);
      }
      return { success: true };
    } catch (error) {
      socket.emit('ai:error', { message: 'AI streaming failed' });
      throw error;
    }
  }

  /** Used by the server game loop to publish transitions that were not caused by a client event. */
  async publishRoundState(roomId: string, event: string, roundId?: string) {
    const state = await this.roomsService.getState(roomId, roundId);
    this.server.to(this.roomChannel(roomId)).emit(event, state);
    this.server.to(this.roomChannel(roomId)).emit('round:state', state);
    return state;
  }

  async publishRoundVerdicts(roomId: string, roundId: string, verdicts: unknown[]) {
    this.server.to(this.roomChannel(roomId)).emit('round:verdicts', { roundId, verdicts });
  }

  private liveStats(state: { pot: number; predictionCount: number; distribution: Record<string, unknown>; odds: Record<string, number> }) {
    return {
      pot: state.pot,
      predictionCount: state.predictionCount,
      distribution: state.distribution,
      odds: state.odds,
    };
  }

  private async assertInRoom(socket: AuthenticatedSocket, roomId: string) {
    if (!roomId || socket.data.roomId !== roomId) throw new UnauthorizedException('Join the room first');
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
    const state = await this.roomsService.getState(room.id);
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

  private assertCuid(value: unknown, fieldName: string) {
    if (typeof value !== 'string' || !CUID_PATTERN.test(value)) {
      throw new BadRequestException(`Invalid ${fieldName}`);
    }
  }

  private assertPositiveInteger(value: unknown, fieldName: string) {
    if (!Number.isInteger(value) || Number(value) < 1) {
      throw new BadRequestException(`Invalid ${fieldName}`);
    }
  }

  private assertNonNegativeInteger(value: unknown, fieldName: string) {
    if (!Number.isInteger(value) || Number(value) < 0) {
      throw new BadRequestException(`Invalid ${fieldName}`);
    }
  }
}
