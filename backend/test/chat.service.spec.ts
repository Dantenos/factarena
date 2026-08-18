import { ForbiddenException } from '@nestjs/common';
import { ChatService } from '../src/chat/chat.service';

describe('ChatService access control', () => {
  it('rejects sending a message when the user is not present in the room', async () => {
    const prisma = {
      room: {
        findUnique: jest.fn().mockResolvedValue({ id: 'room-1' }),
      },
      message: {
        findMany: jest.fn(),
        create: jest.fn(),
      },
    };
    const aiService = { moderate: jest.fn() };
    const roomPresence = { isMember: jest.fn().mockResolvedValue(false) };
    const service = new ChatService(prisma as never, aiService as never, roomPresence as never);

    await expect(service.sendMessage('user-1', 'room-1', 'hello'))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect(roomPresence.isMember).toHaveBeenCalledWith('user-1', 'room-1');
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(aiService.moderate).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('rejects reading room messages when the user is not present in the room', async () => {
    const prisma = {
      message: {
        findMany: jest.fn(),
      },
    };
    const roomPresence = { isMember: jest.fn().mockResolvedValue(false) };
    const service = new ChatService(prisma as never, {} as never, roomPresence as never);

    await expect(service.findByRoom('room-1', 'user-1'))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect(roomPresence.isMember).toHaveBeenCalledWith('user-1', 'room-1');
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('allows reading room messages for a present user', async () => {
    const messages = [{ id: 'message-1', content: 'hello' }];
    const prisma = {
      message: {
        findMany: jest.fn().mockResolvedValue(messages),
      },
    };
    const roomPresence = { isMember: jest.fn().mockResolvedValue(true) };
    const service = new ChatService(prisma as never, {} as never, roomPresence as never);

    await expect(service.findByRoom('room-1', 'user-1')).resolves.toEqual(messages);
    expect(prisma.message.findMany).toHaveBeenCalledTimes(1);
  });
});
