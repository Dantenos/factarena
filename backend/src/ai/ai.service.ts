import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly aiBaseUrl = process.env.AI_SERVICE_URL || 'http://ai-service:8000';

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
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

  async askRag(question: string, limit = 4) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.aiBaseUrl}/rag/ask`, { question, limit }),
      );
      return {
        success: true,
        data: response.data,
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

  async chat(prompt: string, messages?: Array<{ role: string; content: string }>) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.aiBaseUrl}/llm/chat`, {
          prompt,
          messages,
        }),
      );
      return {
        success: true,
        data: response.data,
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

  async moderate(message: string, history?: string[]) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.aiBaseUrl}/moderation/check`, {
          message,
          history,
        }),
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
          data: { decision: 'delete', reason: 'fallback moderation heuristic' },
        };
      }
      if (/stupide|bête|nul/.test(lowered)) {
        return {
          success: false,
          data: { decision: 'warn', reason: 'fallback moderation heuristic' },
        };
      }
      return {
        success: false,
        data: { decision: 'allow', reason: 'fallback moderation heuristic' },
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
    const confidence = typeof ragData.confidence === 'number' ? ragData.confidence : 0.5;

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
}
