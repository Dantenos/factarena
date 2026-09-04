import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

type Bucket = { startedAt: number; count: number };

@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  consume(key: string, maxRequests: number, windowMs: number) {
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket = !current || now - current.startedAt >= windowMs
      ? { startedAt: now, count: 0 }
      : current;

    bucket.count += 1;
    this.buckets.set(key, bucket);
    if (bucket.count > maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000));
      throw new HttpException({
        message: 'Trop de tentatives. Veuillez réessayer plus tard.',
        retryAfter,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
