import { IsOptional, IsString, Min } from 'class-validator';

export class ClaimVerdictRequestDto {
  @IsOptional()
  @IsString()
  question?: string;

  @IsOptional()
  @Min(1)
  limit?: number;
}
