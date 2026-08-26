import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';

type AiCitation = { title?: string; url?: string };

type ParsedSse = {
  answer: string;
  citations: AiCitation[];
};

class AiResponseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiResponseParseError';
  }
}

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
      throw this.toAiHttpException(error, 'AI health check');
    }
  }

  async askRag(
    question: string,
    limit = 4,
    rateKey = 'internal',
    // Contexte de la manche en cours (vide par défaut = hors partie). Transmis
    // au garde-fou anti-spoil du service IA : sans lui, le bot pourrait révéler
    // si un clip en jeu est vrai ou faux (cf. docs/AI.md §9). Les noms partent
    // en snake_case car c'est le contrat FastAPI (live_topics / live_claims).
    live: { topics?: string[]; claims?: string[] } = {},
  ) {
    this.rateLimit.consume(`rag:${rateKey}`, 20, 60_000);
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiBaseUrl}/rag/ask`,
          {
            question,
            limit,
            live_topics: live.topics ?? [],
            live_claims: live.claims ?? [],
          },
          {
            responseType: 'text',
            timeout: 120_000,
          },
        ),
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
      throw this.toAiHttpException(error, 'RAG request');
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
      throw this.toAiHttpException(error, 'LLM request');
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
      // Moderation is deliberately fail-open: a temporary AI outage must not
      // turn the chat into a wordlist-based filter. The caller can expose this
      // status and apply an operational policy without losing the message.
      return {
        success: true,
        data: {
          action: 'allow',
          moderation_status: 'moderation_unavailable',
          reason: 'AI moderation is temporarily unavailable',
        },
      };
    }
  }

  /**
   * Demande au service IA ce qu'il aurait répondu sur une affirmation, sans lui
   * communiquer la clé de réponse et en écartant l'article dont elle est issue.
   * Sert uniquement à l'affichage à la révélation : ce résultat n'entre JAMAIS
   * dans le calcul du score.
   */
  async secondAvis(claim: string, exclureUrl?: string) {
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.aiBaseUrl}/rag/second-avis`,
        { claim, exclure_url: exclureUrl ?? null },
        { timeout: 120_000 },
      ),
    );
    return response.data as { avis?: string; pourquoi?: string };
  }

  async generateClaimVerdict(claimId: string, question?: string, limit = 4) {
    const claim = await this.prisma.claim.findUnique({ where: { id: claimId } });
    if (!claim) {
      throw new NotFoundException(`Claim ${claimId} not found`);
    }

    const ragResponse = await this.askRag(question || claim.text, limit);
    const ragData = ragResponse.data ?? {};
    let verdictText = ragData.answer || 'Verdict indisponible.';
    const citations = Array.isArray(ragData.citations) ? ragData.citations : [];
    const confidence = 0.5;

    // SECOND AVIS : on demande à l'IA ce qu'ELLE aurait répondu, sans lui donner
    // la clé et en excluant l'article de fact-check dont la claim est issue.
    // Sans cette exclusion l'exercice n'a aucune valeur : le corpus contient
    // l'article, et le modèle se contente d'y lire le verdict.
    //
    // Affiché à la révélation À CÔTÉ du verdict officiel — jamais à la place.
    // Quand l'IA se trompe, le score n'en dépend pas (décision d'architecture
    // n°1), et cela montre honnêtement les limites d'une IA face au
    // fact-checking. Mesuré sur un échantillon : elle voit juste une fois sur
    // quatre lorsqu'elle est privée de sa source.
    try {
      const avis = await this.secondAvis(claim.text, claim.sourceUrl ?? undefined);
      if (avis?.avis) {
        verdictText += `\n\nSecond avis de l'IA (sans sa source) : ${avis.avis}. ${avis.pourquoi ?? ''}`;
      }
    } catch {
      // Le second avis est un bonus : son échec ne doit pas priver le joueur
      // de l'explication principale.
    }

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

  /**
   * Variante RAG de `streamChat` : même streaming SSE, mais vers /rag/ask.
   *
   * POURQUOI cette méthode existe : le bot du chat passait par /llm/chat, donc
   * il répondait SANS source. Or c'est justement la citation de sources qui
   * démontre le module RAG. Ici on garde le streaming (exigé par le module LLM)
   * ET on récupère l'événement `sources`.
   *
   * `live` porte le contexte de la manche en cours jusqu'au garde-fou anti-spoil
   * du service IA (docs/AI.md §9) : c'est lui qui refuse de répondre si la
   * question porte sur un clip en jeu.
   */
  async *streamRag(
    prompt: string,
    rateKey: string,
    live: { topics?: string[]; claims?: string[] } = {},
  ): AsyncGenerator<AiStreamEvent> {
    this.rateLimit.consume(`rag:${rateKey}`, 20, 60_000);
    try {
      const response = await firstValueFrom(this.httpService.post(
        `${this.aiBaseUrl}/rag/ask`,
        { question: prompt, live_topics: live.topics ?? [], live_claims: live.claims ?? [] },
        { responseType: 'stream', timeout: 120_000 },
      ));

      let buffer = '';
      let receivedEvent = false;
      for await (const chunk of response.data as AsyncIterable<Buffer | string>) {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const event of events) {
          const parsed = this.parseSseEvent(event);
          if (parsed) {
            receivedEvent = true;
            yield parsed;
          }
        }
      }
      const finalEvent = this.parseSseEvent(buffer);
      if (finalEvent) {
        receivedEvent = true;
        yield finalEvent;
      }
      if (!receivedEvent) throw new AiResponseParseError('AI service returned no SSE events');
    } catch (error) {
      this.logger.warn(`RAG stream failed: ${String(error)}`);
      throw this.toAiHttpException(error, 'RAG stream');
    }
  }

  async *streamChat(prompt: string, rateKey: string): AsyncGenerator<AiStreamEvent> {
    this.rateLimit.consume(`llm:${rateKey}`, 10, 60_000);
    try {
      const response = await firstValueFrom(this.httpService.post(
        `${this.aiBaseUrl}/llm/chat`,
        { message: prompt },
        { responseType: 'stream', timeout: 120_000 },
      ));

      let buffer = '';
      let receivedEvent = false;
      for await (const chunk of response.data as AsyncIterable<Buffer | string>) {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const event of events) {
          const parsed = this.parseSseEvent(event);
          if (parsed) {
            receivedEvent = true;
            yield parsed;
          }
        }
      }
      const finalEvent = this.parseSseEvent(buffer);
      if (finalEvent) {
        receivedEvent = true;
        yield finalEvent;
      }
      if (!receivedEvent) throw new AiResponseParseError('AI service returned no SSE events');
    } catch (error) {
      this.logger.warn(`LLM stream failed: ${String(error)}`);
      throw this.toAiHttpException(error, 'LLM stream');
    }
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
      throw new AiResponseParseError('AI service returned a non-stream response');
    }

    let answer = '';
    let citations: AiCitation[] = [];
    let recognizedEvent = false;
    const events = payload.split(/\r?\n\r?\n/);

    for (const event of events) {
      const eventName = event.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const dataLine = event.match(/^data:\s*(.+)$/m)?.[1];
      if (!event.trim()) continue;
      if (!eventName || !dataLine) {
        throw new AiResponseParseError('AI service returned malformed SSE data');
      }

      let data: unknown;
      try {
        data = JSON.parse(dataLine);
      } catch {
        throw new AiResponseParseError('AI service returned invalid SSE JSON');
      }

      if (eventName === 'sources' && Array.isArray(data)) {
        recognizedEvent = true;
        citations = data.filter((item): item is AiCitation => typeof item === 'object' && item !== null);
      }
      if (eventName === 'token' && typeof data === 'object' && data !== null && 'text' in data) {
        const text = (data as { text?: unknown }).text;
        if (typeof text !== 'string') throw new AiResponseParseError('AI token has invalid text');
        recognizedEvent = true;
        answer += text;
      }
      if (eventName === 'done') recognizedEvent = true;
      if (eventName === 'error') {
        throw new Error('AI streaming failed');
      }
      if (!['sources', 'token', 'done'].includes(eventName)) {
        throw new AiResponseParseError(`Unknown AI SSE event: ${eventName}`);
      }
    }

    if (!recognizedEvent) throw new AiResponseParseError('AI service returned no valid SSE events');

    return { answer, citations };
  }

  private parseSseEvent(event: string): AiStreamEvent | null {
    const eventName = event.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const dataLine = event.match(/^data:\s*(.+)$/m)?.[1];
    if (!event.trim()) return null;
    if (!eventName || !dataLine) throw new AiResponseParseError('AI service returned malformed SSE data');
    if (dataLine === '[DONE]') return { type: 'done', data: {} };
    let data: unknown;
    try {
      data = JSON.parse(dataLine) as unknown;
    } catch {
      throw new AiResponseParseError('AI service returned invalid SSE JSON');
    }
    if (eventName === 'sources' && Array.isArray(data)) {
      return { type: 'sources', data: data.filter((item): item is AiCitation => typeof item === 'object' && item !== null) };
    }
    if (eventName === 'token' && typeof data === 'object' && data !== null && 'text' in data) {
      const text = (data as { text?: unknown }).text;
      if (typeof text !== 'string') throw new AiResponseParseError('AI token has invalid text');
      return { type: 'token', data: { text } };
    }
    if (eventName === 'done') return { type: 'done', data: {} };
    if (eventName === 'error') throw new Error('AI streaming failed');
    throw new AiResponseParseError(`Unknown AI SSE event: ${eventName}`);
  }

  private toAiHttpException(error: unknown, operation: string): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof AiResponseParseError) {
      return new BadGatewayException({
        code: 'AI_INVALID_RESPONSE',
        message: `${operation} returned an invalid response`,
      });
    }

    const candidate = (error ?? {}) as {
      code?: unknown;
      message?: unknown;
      response?: { status?: unknown; data?: unknown };
    };
    const status = typeof candidate.response?.status === 'number' ? candidate.response.status : undefined;
    if (status === 429) {
      return new HttpException({
        code: 'AI_RATE_LIMITED',
        message: 'The AI service rate limit has been reached',
        retryAfterSeconds: this.getRetryAfterSeconds(candidate.response?.data),
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (candidate.code === 'ECONNABORTED' || candidate.code === 'ETIMEDOUT' || candidate.code === 'ESOCKETTIMEDOUT') {
      return new GatewayTimeoutException({ code: 'AI_TIMEOUT', message: `${operation} timed out` });
    }
    if (candidate.code === 'ECONNREFUSED' || candidate.code === 'ENOTFOUND' || candidate.code === 'EHOSTUNREACH') {
      return new ServiceUnavailableException({ code: 'AI_UNAVAILABLE', message: 'The AI service is unavailable' });
    }
    if (status !== undefined && status >= 500) {
      return new ServiceUnavailableException({ code: 'AI_TEMPORARY_ERROR', message: 'The AI service failed temporarily' });
    }
    if (status !== undefined && status >= 400) {
      return new BadGatewayException({ code: 'AI_UPSTREAM_ERROR', message: 'The AI service rejected the request' });
    }
    return new ServiceUnavailableException({ code: 'AI_UNAVAILABLE', message: 'The AI service is unavailable' });
  }

  private getRetryAfterSeconds(data: unknown): number {
    if (typeof data === 'object' && data !== null && 'retry_after' in data) {
      const retryAfter = (data as { retry_after?: unknown }).retry_after;
      if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
        return Math.ceil(retryAfter);
      }
    }
    return 30;
  }
}
