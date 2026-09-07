import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';

describe('AuthService', () => {
  it('normalizes the email when registering', async () => {
    const createdUser = {
      id: 'u1',
      email: 'person@example.com',
      avatarUrl: null,
      displayName: null,
      status: 'OFFLINE',
      role: 'USER',
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdUser),
      },
    };
    const service = new AuthService(prisma as never, { sign: jest.fn() } as never);

    await service.register({ email: '  Person@Example.COM  ', password: 'password123', displayName: 'Person' });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'person@example.com' } });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'person@example.com', role: 'USER' }),
    });
  });

  it('normalizes the email when logging in', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    const user = {
      id: 'u1',
      email: 'person@example.com',
      passwordHash,
      avatarUrl: null,
      displayName: null,
      status: 'OFFLINE',
      role: 'USER',
    };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
    const service = new AuthService(prisma as never, { sign: jest.fn().mockReturnValue('token') } as never);

    await service.login({ email: ' PERSON@EXAMPLE.COM ', password: 'password123' });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'person@example.com' } });
  });

  it('reports a concurrent normalized-email collision without throwing', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
      },
    };
    const service = new AuthService(prisma as never, { sign: jest.fn() } as never);

    await expect(service.register({ email: ' New@Example.com ', password: 'password123', displayName: 'New player' }))
      .resolves.toEqual({ alreadyExists: true, message: 'Adresse e-mail déjà utilisée' });
  });

  it('does not authenticate an invalid password', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@test.local', passwordHash: '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalid' }) } };
    const jwt = { sign: jest.fn() };
    const service = new AuthService(prisma as never, jwt as never);

    await expect(service.login({ email: 'a@test.local', password: 'incorrect' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('creates a new user for a valid OAuth identity', async () => {
    const createdUser = {
      id: 'user-1',
      email: 'person@example.com',
      displayName: 'Person',
      avatarUrl: null,
      status: 'OFFLINE',
      role: 'USER',
    };
    const prisma = {
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockResolvedValue(createdUser),
      },
    };
    const jwt = { sign: jest.fn().mockReturnValue('oauth-token') };
    const service = new AuthService(prisma as never, jwt as never);

    await expect(service.findOrCreateOAuthUser({
      provider: '42',
      providerId: '42-user-1',
      email: ' Person@Example.com ',
      displayName: 'Person',
    })).resolves.toEqual({
      accessToken: 'oauth-token',
      user: createdUser,
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'person@example.com',
        displayName: 'Person',
        avatarUrl: undefined,
        oauthProvider: '42',
        oauthProviderId: '42-user-1',
        role: 'USER',
      },
    });
  });

  it('rejects an OAuth identity with a missing provider id', async () => {
    const prisma = { user: { findUnique: jest.fn(), create: jest.fn() } };
    const service = new AuthService(prisma as never, { sign: jest.fn() } as never);

    await expect(service.findOrCreateOAuthUser({
      provider: '42',
      providerId: ' ',
      email: 'person@example.com',
    })).rejects.toThrow('Identité du fournisseur OAuth invalide');

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('does not silently link OAuth to an existing email account', async () => {
    const existingUser = { id: 'user-1', email: 'person@example.com' };
    const prisma = {
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(existingUser),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    const service = new AuthService(prisma as never, { sign: jest.fn() } as never);

    await expect(service.findOrCreateOAuthUser({
      provider: '42',
      providerId: '42-user-1',
      email: 'person@example.com',
    })).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe('AuthController OAuth callback', () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;

  afterEach(() => {
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
  });

  it('redirects to the configured frontend with the issued token', async () => {
    process.env.FRONTEND_URL = 'https://localhost';
    const controller = new AuthController({} as never);
    const response = { redirect: jest.fn(), json: jest.fn() };

    await controller.authenticateWith42Callback(
      { user: { accessToken: 'oauth-token', user: {} } } as never,
      response as never,
    );

    expect(response.redirect).toHaveBeenCalledWith(
      'https://localhost/auth/callback?token=oauth-token',
    );
    expect(response.json).not.toHaveBeenCalled();
  });
});
