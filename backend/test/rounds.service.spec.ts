import { RoundsService } from '../src/rounds/rounds.service';

describe('RoundsService settlement', () => {
  it('distributes the complete pot atomically between closest predictions', async () => {
    const predictions = [
      { id: 'p1', userId: 'u1', predictedFakeCount: 2, stake: 30 },
      { id: 'p2', userId: 'u2', predictedFakeCount: 4, stake: 20 },
      { id: 'p3', userId: 'u3', predictedFakeCount: 3, stake: 10 },
    ];
    const tx = {
      round: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', status: 'LOCKED', trueFakeCount: 3, predictions }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'r1', status: 'REVEALED', predictions }),
      },
      prediction: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)) };
    const ledger = { creditPayout: jest.fn().mockResolvedValue({}) };
    const service = new RoundsService(prisma as never, ledger as never);

    await service.revealAndSettle('r1');

    expect(tx.round.updateMany).toHaveBeenCalledWith({ where: { id: 'r1', status: 'LOCKED' }, data: { status: 'REVEALED', revealedAt: expect.any(Date) } });
    expect(ledger.creditPayout).toHaveBeenCalledWith(tx, 'u3', 60);
    expect(tx.prediction.update).toHaveBeenCalledTimes(3);
  });
});
