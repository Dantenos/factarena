import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';

type AiCitation = { title?: string; url?: string };

type ParsedSse = {
  answer: string;
  citations: AiCitation[];
};

export type AiStreamEvent =
  | { type: 'sources'; data: AiCitation[] }
  | { type: 'token'; data: { text: string } }
  | { type: 'done'; data: Record<string, never> };

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly aiBaseUrl = process.env.AI_SERVICE_URL || 'http://ai-service:8000';

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async health() {
    try {
      const response = await firstValueFrom(this.httpService.get(`${this.aiBaseUrl}/health`));
      return response.data;
    } catch (error) {
      this.logger.warn(`AI service health check failed: ${String(error)}`);
      return { status: 'unavailable' };
    }
  }

  async askRag(question: string, limit = 4, rateKey = 'internal') {
    this.rateLimit.consume(`rag:${rateKey}`, 20, 60_000);
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.aiBaseUrl}/rag/ask`, { question, limit }, {
          responseType: 'text',
          timeout: 120_000,
        }),
      );
      const parsed = this.parseSse(response.data);
      return {
        success: true,
        data: {
          ...parsed,
          context_chunks: parsed.citations.length,
        },
      };
    } catch (error) {
      this.logger.warn(`RAG request failed: ${String(error)}`);
      return {
        success: false,
        data: {
          answer: `Analyse IA indisponible pour la question : ${question}`,
          citations: [],
          context_chunks: 0,
        },
      };
    }
  }

  async chat(prompt: string, messages?: Array<{ role: string; content: string }>, rateKey = 'internal') {
    this.rateLimit.consume(`llm:${rateKey}`, 10, 60_000);
    try {
      // The FastAPI contract deliberately accepts one `message` field. The
      // optional Nest DTO history is not forwarded because the AI service's
      // free LLM endpoint is intentionally retrieval-free.
      const response = await firstValueFrom(
        this.httpService.post(`${this.aiBaseUrl}/llm/chat`, { message: prompt }, {
          responseType: 'text',
          timeout: 120_000,
        }),
      );
      return {
        success: true,
        data: this.parseSse(response.data),
      };
    } catch (error) {
      this.logger.warn(`LLM request failed: ${String(error)}`);
      return {
        success: false,
        data: {
          answer: `Réponse IA indisponible pour la demande : ${prompt}`,
        },
      };
    }
  }

  async moderate(message: string, history?: string[], rateKey = 'internal') {
    this.rateLimit.consume(`moderation:${rateKey}`, 60, 60_000);
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.aiBaseUrl}/moderation/check`, { message, history }),
      );
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      this.logger.warn(`Moderation request failed: ${String(error)}`);
      const lowered = message.toLowerCase();
      if (/idiot|connard|putain|fuck|shit|salope/.test(lowered)) {
        return {
          success: false,
          data: { action: 'delete', reason: 'fallback moderation heuristic' },
        };
      }
      if (/stupide|bête|nul/.test(lowered)) {
        return {
          success: false,
          data: { action: 'warn', reason: 'fallback moderation heuristic' },
        };
      }
      return {
        success: false,
        data: { action: 'allow', reason: 'fallback moderation heuristic' },
      };
    }
  }

  async generateClaimVerdict(claimId: string, question?: string, limit = 4) {
    const claim = await this.prisma.claim.findUnique({ where: { id: claimId } });
    if (!claim) {
      throw new NotFoundException(`Claim ${claimId} not found`);
    }

    const ragResponse = await this.askRag(question || claim.text, limit);
    const ragData = ragResponse.data ?? {};
    const verdictText = ragData.answer || 'Verdict indisponible.';
    const citations = Array.isArray(ragData.citations) ? ragData.citations : [];
    const confidence = 0.5;

    const verdict = await this.prisma.claimVerdict.upsert({
      where: { claimId },
      update: {
        verdictText,
        confidence,
        citations: citations as any,
      },
      create: {
        claimId,
        verdictText,
        confidence,
        citations: citations as any,
      },
    });

    return {
      success: true,
      data: {
        claimId,
        verdictText: verdict.verdictText,
        confidence: verdict.confidence ?? 0.5,
        citations: (verdict.citations as string[]) || [],
      },
    };
  }

  async generateRoundVerdicts(roundId: string) {
    const round = await this.prisma.round.findUnique({
      where: { id: roundId },
      include: { roundClaims: { orderBy: { orderIndex: 'asc' }, include: { claim: { include: { verdicts: true } } } } },
    });
    if (!round) throw new NotFoundException(`Round ${roundId} not found`);

    const verdicts = await Promise.all(round.roundClaims.filter(({ claim }) => claim.verdicts.length === 0).map(async ({ claim }) => {
      try {
        return await this.generateClaimVerdict(claim.id);
      } catch (error) {
        this.logger.warn(`Verdict generation failed for claim ${claim.id}: ${String(error)}`);
        return { success: false, data: { claimId: claim.id, verdictText: 'Verdict indisponible.', citations: [], confidence: 0 } };
      }
    }));
    return verdicts;
  }

  async *streamChat(prompt: string, rateKey: string): AsyncGenerator<AiStreamEvent> {
    this.rateLimit.consume(`llm:${rateKey}`, 10, 60_000);
    const response = await firstValueFrom(this.httpService.post(
      `${this.aiBaseUrl}/llm/chat`,
      { message: prompt },
      { responseType: 'stream', timeout: 120_000 },
    ));

    let buffer = '';
    for await (const chunk of response.data as AsyncIterable<Buffer | string>) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const event of events) {
        const parsed = this.parseSseEvent(event);
        if (parsed) yield parsed;
      }
    }
    const finalEvent = this.parseSseEvent(buffer);
    if (finalEvent) yield finalEvent;
    yield { type: 'done', data: {} };
  }

  async getClaimVerdict(claimId: string) {
    const verdict = await this.prisma.claimVerdict.findUnique({ where: { claimId } });
    if (!verdict) {
      throw new NotFoundException(`No verdict found for claim ${claimId}`);
    }

    return {
      success: true,
      data: {
        claimId: verdict.claimId,
        verdictText: verdict.verdictText,
        confidence: verdict.confidence ?? 0.5,
        citations: (verdict.citations as string[]) || [],
      },
    };
  }

  private parseSse(payload: unknown): ParsedSse {
    if (typeof payload !== 'string') {
      throw new Error('AI service returned a non-stream response');
    }

    let answer = '';
    let citations: AiCitation[] = [];
    const events = payload.split(/\r?\n\r?\n/);

    for (const event of events) {
      const eventName = event.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const dataLine = event.match(/^data:\s*(.+)$/m)?.[1];
      if (!eventName || !dataLine) continue;

      let data: unknown;
      try {
        data = JSON.parse(dataLine);
      } catch {
        continue;
      }

      if (eventName === 'sources' && Array.isArray(data)) {
        citations = data.filter((item): item is AiCitation => typeof item === 'object' && item !== null);
      }
      if (eventName === 'token' && typeof data === 'object' && data !== null && 'text' in data) {
        const text = (data as { text?: unknown }).text;
        if (typeof text === 'string') answer += text;
      }
      if (eventName === 'error') {
        throw new Error('AI streaming failed');
      }
    }

    return { answer, citations };
  }

  private parseSseEvent(event: string): AiStreamEvent | null {
    const eventName = event.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const dataLine = event.match(/^data:\s*(.+)$/m)?.[1];
    if (!eventName || !dataLine) return null;
    if (dataLine === '[DONE]') return { type: 'done', data: {} };
    try {
      const data = JSON.parse(dataLine) as unknown;
      if (eventName === 'sources' && Array.isArray(data)) {
        return { type: 'sources', data: data.filter((item): item is AiCitation => typeof item === 'object' && item !== null) };
      }
      if (eventName === 'token' && typeof data === 'object' && data !== null && 'text' in data) {
        const text = (data as { text?: unknown }).text;
        if (typeof text === 'string') return { type: 'token', data: { text } };
      }
    } catch {
      return null;
    }
    return null;
  }
}
