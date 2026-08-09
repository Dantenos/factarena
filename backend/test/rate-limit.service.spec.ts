import { HttpException } from '@nestjs/common';
import { RateLimitService } from '../src/common/rate-limit.service';

describe('RateLimitService', () => {
  it('rejects requests after the configured limit', () => {
    const limiter = new RateLimitService();
    limiter.consume('user-1', 2, 60_000);
    limiter.consume('user-1', 2, 60_000);

    expect(() => limiter.consume('user-1', 2, 60_000)).toThrow(HttpException);
    expect(() => limiter.consume('user-2', 2, 60_000)).not.toThrow();
  });
});
