import { IsInt, Matches, Max, Min } from 'class-validator';
import { CUID_PATTERN } from '../../common/pipes/cuid-param.pipe';

export class CreatePredictionDto {
  @Matches(CUID_PATTERN)
  roundId!: string;

  @IsInt()
  @Min(0)
  predictedFakeCount!: number;

  @IsInt()
  @Min(1)
  @Max(100000)
  stake!: number;
}
