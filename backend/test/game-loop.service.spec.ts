import { GameLoopService } from '../src/realtime/game-loop.service';

describe('GameLoopService transitions', () => {
  it('opens then locks an overdue countdown before attempting settlement', async () => {
    const prisma = {
      round: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'round-1',
          roomId: 'room-1',
          status: 'COUNTDOWN',
          opensAt: new Date(Date.now() - 5_000),
          locksAt: new Date(Date.now() - 1_000),
        }]),
      },
    };
    const rounds = {
      openIfDue: jest.fn().mockResolvedValue({ locksAt: new Date(Date.now() - 1_000) }),
      lockIfDue: jest.fn().mockResolvedValue({ id: 'round-1' }),
      revealAndSettle: jest.fn().mockResolvedValue({ id: 'round-1' }),
      finish: jest.fn().mockResolvedValue({ id: 'round-1' }),
    };
    const gateway = {
      publishRoundState: jest.fn().mockResolvedValue({}),
      publishRoundVerdicts: jest.fn().mockResolvedValue(undefined),
    };
    const ai = { generateRoundVerdicts: jest.fn().mockResolvedValue([]) };
    const service = new GameLoopService(prisma as never, rounds as never, gateway as never, ai as never);

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(rounds.openIfDue).toHaveBeenCalledWith('round-1');
    expect(rounds.lockIfDue).toHaveBeenCalledWith('round-1');
    expect(rounds.revealAndSettle).toHaveBeenCalledWith('round-1');
  });

  it('resumes a persisted revealed round after a service restart', async () => {
    const prisma = {
      round: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'round-2',
          roomId: 'room-2',
          status: 'REVEALED',
          opensAt: new Date(Date.now() - 20_000),
          locksAt: new Date(Date.now() - 10_000),
        }]),
      },
    };
    const rounds = {
      finish: jest.fn().mockResolvedValue({ id: 'round-2' }),
    };
    const gateway = {
      publishRoundState: jest.fn().mockResolvedValue({}),
      publishRoundVerdicts: jest.fn().mockResolvedValue(undefined),
    };
    const ai = { generateRoundVerdicts: jest.fn().mockResolvedValue([]) };
    const service = new GameLoopService(prisma as never, rounds as never, gateway as never, ai as never);

    await (service as unknown as { tick: () => Promise<void> }).tick();

    expect(ai.generateRoundVerdicts).toHaveBeenCalledWith('round-2');
    expect(rounds.finish).toHaveBeenCalledWith('round-2');
    expect(gateway.publishRoundState).toHaveBeenCalledWith('room-2', 'round:finished', 'round-2');
  });
});
