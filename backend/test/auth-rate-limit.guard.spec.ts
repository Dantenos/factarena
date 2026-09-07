import { ExecutionContext, HttpException } from '@nestjs/common';
import { AuthRateLimitGuard } from '../src/auth/guards/auth-rate-limit.guard';
import { RateLimitService } from '../src/common/rate-limit.service';

function context(handlerName: string, ip = '203.0.113.10', email?: string): ExecutionContext {
  return {
    getHandler: () => ({ name: handlerName }),
    switchToHttp: () => ({
      getRequest: () => ({ ip, body: email ? { email } : {}, socket: { remoteAddress: ip } }),
    }),
  } as unknown as ExecutionContext;
}

describe('AuthRateLimitGuard', () => {
  it('limits login attempts per IP', () => {
    const guard = new AuthRateLimitGuard(new RateLimitService());
    const request = context('login');

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(guard.canActivate(request)).toBe(true);
    }
    expect(() => guard.canActivate(request)).toThrow(HttpException);
  });

  it('keeps separate email buckets for registration', () => {
    const guard = new AuthRateLimitGuard(new RateLimitService());

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(guard.canActivate(context('register', '203.0.113.11', 'one@example.com'))).toBe(true);
    }
    expect(() => guard.canActivate(context('register', '203.0.113.11', 'one@example.com'))).toThrow(HttpException);
    expect(guard.canActivate(context('register', '203.0.113.11', 'two@example.com'))).toBe(true);
    expect(guard.canActivate(context('register', '203.0.113.12', 'one@example.com'))).toBe(true);
    expect(guard.canActivate(context('login', '203.0.113.11'))).toBe(true);
  });
});
