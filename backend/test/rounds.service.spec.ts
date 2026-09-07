import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RoundsService } from '../src/rounds/rounds.service';

describe('RoundsService room ownership', () => {
  it('accepts a round that belongs to the requested room', async () => {
    const prisma = {
      round: {
        findFirst: jest.fn().mockResolvedValue({ id: 'round-1' }),
      },
    };
    const service = new RoundsService(prisma as never, {} as never);

    await expect(service.assertBelongsToRoom('round-1', 'room-1')).resolves.toBeUndefined();
    expect(prisma.round.findFirst).toHaveBeenCalledWith({
      where: { id: 'round-1', roomId: 'room-1' },
      select: { id: true },
    });
  });

  it('rejects a round that does not belong to the requested room', async () => {
    const prisma = {
      round: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new RoundsService(prisma as never, {} as never);

    await expect(service.assertBelongsToRoom('round-1', 'room-2'))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RoundsService settlement', () => {
  it('requires two active room members to create a round', async () => {
    const service = new RoundsService(
      {} as never,
      {} as never,
      { getMemberIds: jest.fn().mockResolvedValue(['host-1']) } as never,
    );

    await expect(service.create({ roomId: 'room-1', claimIds: ['claim-1'], durationSeconds: 30 }, 'host-1'))
      .rejects.toThrow('Il faut au moins 2 joueurs présents pour lancer une manche');
  });

  it('does not reopen an already open round or relock an already locked round', async () => {
    const prisma = {
      round: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = new RoundsService(prisma as never, {} as never);

    await expect(service.openIfDue('open-round')).resolves.toBeNull();
    await expect(service.lockIfDue('locked-round')).resolves.toBeNull();
    expect(prisma.round.updateMany).toHaveBeenCalledTimes(2);
  });

  it('rejects a round without claims at creation time', async () => {
    const service = new RoundsService({} as never, {} as never);

    await expect(service.create({ roomId: 'room-1', claimIds: [], durationSeconds: 30 }, 'host-1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not lock an open round before its deadline', async () => {
    const prisma = {
      round: {
        findUnique: jest.fn().mockResolvedValue({ room: { createdBy: 'host-1', status: 'IN_PROGRESS' } }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = new RoundsService(prisma as never, {} as never);

    await expect(service.lock('round-1', 'host-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.round.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'OPEN', locksAt: { lte: expect.any(Date) } }),
    }));
  });

  it('rejects manual actions on a finished room', async () => {
    const prisma = {
      round: {
        findUnique: jest.fn().mockResolvedValue({ room: { createdBy: 'host-1', status: 'FINISHED' } }),
      },
    };
    const service = new RoundsService(prisma as never, {} as never);

    await expect(service.lock('round-1', 'host-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects revealing a round without claims', async () => {
    const tx = {
      round: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'round-1',
          status: 'LOCKED',
          room: { status: 'IN_PROGRESS' },
          roundClaims: [],
          predictions: [],
        }),
      },
    };
    const prisma = { $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)) };
    const service = new RoundsService(prisma as never, {} as never);

    await expect(service.revealAndSettle('round-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('distributes the complete pot atomically between closest predictions', async () => {
    const predictions = [
      { id: 'p1', userId: 'u1', predictedFakeCount: 2, stake: 30 },
      { id: 'p2', userId: 'u2', predictedFakeCount: 4, stake: 20 },
      { id: 'p3', userId: 'u3', predictedFakeCount: 3, stake: 10 },
    ];
    const tx = {
      round: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', status: 'LOCKED', trueFakeCount: 3, room: { status: 'IN_PROGRESS' }, roundClaims: [{ id: 'claim-1' }], predictions }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'r1', status: 'REVEALED', predictions }),
      },
      prediction: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)) };
    const ledger = { creditPayout: jest.fn().mockResolvedValue({}) };
    const service = new RoundsService(prisma as never, ledger as never);

    await service.revealAndSettle('r1');

    expect(tx.round.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'LOCKED', room: { status: { not: 'FINISHED' } } },
      data: { status: 'REVEALED', revealedAt: expect.any(Date) },
    });
    expect(ledger.creditPayout).toHaveBeenCalledWith(tx, 'u3', 60, 'payout:p3');
    expect(tx.prediction.update).toHaveBeenCalledTimes(3);
  });

  it('reveals a locked round with no predictions without creating payouts', async () => {
    const tx = {
      round: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r-empty', status: 'LOCKED', trueFakeCount: 1, room: { status: 'IN_PROGRESS' }, roundClaims: [{ id: 'claim-1' }], predictions: [] }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'r-empty', status: 'REVEALED' }),
      },
      prediction: { update: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)) };
    const service = new RoundsService(prisma as never, { creditPayout: jest.fn() } as never);

    await expect(service.revealAndSettle('r-empty')).resolves.toMatchObject({ status: 'REVEALED' });
    expect(tx.prediction.update).not.toHaveBeenCalled();
  });

  it('settles a round only once when reveal calls race', async () => {
    let updateCount = 0;
    const tx = {
      round: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', status: 'LOCKED', trueFakeCount: 0, room: { status: 'IN_PROGRESS' }, roundClaims: [{ id: 'claim-1' }], predictions: [] }),
        updateMany: jest.fn().mockImplementation(async () => ({ count: updateCount++ === 0 ? 1 : 0 })),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'r1', status: 'REVEALED' }),
      },
    };
    const prisma = { $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)) };
    const service = new RoundsService(prisma as never, {} as never);

    const results = await Promise.allSettled([
      service.revealAndSettle('r1'),
      service.revealAndSettle('r1'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('makes finishing a revealed round idempotent', async () => {
    let updateCount = 0;
    const tx = {
      round: {
        updateMany: jest.fn().mockImplementation(async () => ({ count: updateCount++ === 0 ? 1 : 0 })),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'r1', roomId: 'room-1', predictions: [] }),
      },
      room: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = { $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)) };
    const service = new RoundsService(prisma as never, {} as never);

    const results = await Promise.all([service.finish('r1'), service.finish('r1')]);

    expect(results[0]).not.toBeNull();
    expect(results[1]).toBeNull();
  });
});
