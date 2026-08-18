import { HttpException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AiService } from '../src/ai/ai.service';
import { RateLimitService } from '../src/common/rate-limit.service';

function createService(post: jest.Mock) {
  return new AiService(
    { post, get: jest.fn() } as never,
    {} as never,
    new RateLimitService(),
  );
}

async function statusOf(action: Promise<unknown>) {
  try {
    await action;
    throw new Error('Expected the request to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return (error as HttpException).getStatus();
  }
}

describe('AiService error handling', () => {
  it('maps an upstream 429 to HTTP 429', async () => {
    const post = jest.fn().mockReturnValue(throwError(() => ({
      response: { status: 429, data: { retry_after: 4.2 } },
    })));
    const service = createService(post);

    expect(await statusOf(service.chat('question'))).toBe(429);
  });

  it('maps a timeout to HTTP 504', async () => {
    const post = jest.fn().mockReturnValue(throwError(() => ({ code: 'ETIMEDOUT' })));
    const service = createService(post);

    expect(await statusOf(service.chat('question'))).toBe(504);
  });

  it('allows moderation with an explicit unavailable status when AI is down', async () => {
    const post = jest.fn().mockReturnValue(throwError(() => ({ code: 'ECONNREFUSED' })));
    const service = createService(post);

    await expect(service.moderate('message')).resolves.toMatchObject({
      success: true,
      data: {
        action: 'allow',
        moderation_status: 'moderation_unavailable',
      },
    });
  });

  it('maps malformed SSE responses to HTTP 502', async () => {
    const post = jest.fn().mockReturnValue(of({ data: 'not valid SSE' }));
    const service = createService(post);

    expect(await statusOf(service.chat('question'))).toBe(502);
  });

  it('returns a successful parsed response for valid SSE', async () => {
    const post = jest.fn().mockReturnValue(of({
      data: 'event: token\ndata: {"text":"Verified"}\n\nevent: done\ndata: {}\n\n',
    }));
    const service = createService(post);

    await expect(service.chat('question')).resolves.toMatchObject({
      success: true,
      data: { answer: 'Verified' },
    });
  });
});
