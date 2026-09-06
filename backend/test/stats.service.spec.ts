import { StatsService } from '../src/stats/stats.service';

describe('StatsService leaderboard', () => {
  it('ranks by score, then by account creation time', async () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'late-zero',
            email: 'late@example.com',
            displayName: null,
            avatarUrl: null,
            status: 'OFFLINE',
            createdAt: new Date('2026-01-03T00:00:00.000Z'),
            virtualBalance: 1000,
            bets: [],
          },
          {
            id: 'winner',
            email: 'winner@example.com',
            displayName: 'Winner',
            avatarUrl: null,
            status: 'ONLINE',
            createdAt: new Date('2026-01-04T00:00:00.000Z'),
            virtualBalance: 1100,
            bets: [{
              stake: 100,
              payout: 200,
              result: 'WIN',
              createdAt: new Date('2026-01-05T00:00:00.000Z'),
              round: { revealedAt: new Date('2026-01-05T00:00:00.000Z'), createdAt: new Date('2026-01-04T00:00:00.000Z') },
            }],
          },
          {
            id: 'first-zero',
            email: 'first@example.com',
            displayName: null,
            avatarUrl: null,
            status: 'OFFLINE',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            virtualBalance: 1000,
            bets: [],
          },
          {
            id: 'second-zero',
            email: 'second@example.com',
            displayName: null,
            avatarUrl: null,
            status: 'OFFLINE',
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            virtualBalance: 1000,
            bets: [],
          },
        ]),
      },
    };
    const service = new StatsService(prisma as never);

    const classement = await service.getLeaderboard();
    expect(classement.slice(0, 3)).toMatchObject([
      { rank: 1, user: { id: 'winner' }, netGain: 100 },
      { rank: 2, user: { id: 'first-zero' }, netGain: 0 },
      { rank: 3, user: { id: 'second-zero' }, netGain: 0 },
    ]);
    expect(classement).toHaveLength(4);
  });
});