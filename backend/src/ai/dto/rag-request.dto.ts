import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RagRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;

  // Contexte de la manche EN COURS, transmis tel quel au garde-fou anti-spoil du
  // service IA (ai-service/app/rag/guardrail.py, cf. ai-service/README.md). Sans ces
  // deux listes le garde-fou est inerte et le bot peut divulguer la clé de
  // réponse du jeu. Vides hors manche -> le bot répond librement.
  //   - liveTopics : mots-thèmes des clips en jeu (filtre déterministe)
  //   - liveClaims : textes des affirmations en jeu (juge LLM)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  liveTopics?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  liveClaims?: string[];
}
