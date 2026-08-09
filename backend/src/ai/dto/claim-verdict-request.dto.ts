import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ClaimVerdictRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  question?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}
