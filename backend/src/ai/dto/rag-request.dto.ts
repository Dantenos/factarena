import { IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class RagRequestDto {
  @IsString()
  @IsNotEmpty()
  question!: string;

  @IsOptional()
  @Min(1)
  limit?: number;
}
