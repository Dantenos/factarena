import { IsInt, IsString, Min } from 'class-validator';

export class CreatePredictionDto {
  @IsString()
  roundId!: string;

  @IsInt()
  @Min(0)
  predictedFakeCount!: number;

  @IsInt()
  @Min(1)
  stake!: number;
}
