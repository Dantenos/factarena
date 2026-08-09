import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';

describe('AuthService', () => {
  it('does not authenticate an invalid password', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@test.local', passwordHash: '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalid' }) } };
    const jwt = { sign: jest.fn() };
    const service = new AuthService(prisma as never, jwt as never);

    await expect(service.login({ email: 'a@test.local', password: 'incorrect' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});
