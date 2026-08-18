import { ServiceUnavailableException } from '@nestjs/common';
import { FortyTwoAuthGuard } from '../src/auth/guards/fortytwo-auth.guard';

describe('FortyTwoAuthGuard', () => {
  const previous = {
    clientId: process.env.FORTYTWO_CLIENT_ID,
    clientSecret: process.env.FORTYTWO_CLIENT_SECRET,
    callbackUrl: process.env.FORTYTWO_CALLBACK_URL,
  };

  afterEach(() => {
    if (previous.clientId === undefined) delete process.env.FORTYTWO_CLIENT_ID;
    else process.env.FORTYTWO_CLIENT_ID = previous.clientId;
    if (previous.clientSecret === undefined) delete process.env.FORTYTWO_CLIENT_SECRET;
    else process.env.FORTYTWO_CLIENT_SECRET = previous.clientSecret;
    if (previous.callbackUrl === undefined) delete process.env.FORTYTWO_CALLBACK_URL;
    else process.env.FORTYTWO_CALLBACK_URL = previous.callbackUrl;
  });

  it('returns a service-unavailable error when OAuth is not configured', () => {
    delete process.env.FORTYTWO_CLIENT_ID;
    delete process.env.FORTYTWO_CLIENT_SECRET;
    delete process.env.FORTYTWO_CALLBACK_URL;

    const guard = new FortyTwoAuthGuard();

    expect(() => guard.canActivate({} as never))
      .toThrow(ServiceUnavailableException);
  });
});
