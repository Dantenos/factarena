import { ArrayMinSize, IsArray, IsInt, Matches, Max, Min } from 'class-validator';
import { CUID_PATTERN } from '../../common/pipes/cuid-param.pipe';

export class CreateRoundDto {
  @Matches(CUID_PATTERN)
  roomId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @Matches(CUID_PATTERN, { each: true })
  claimIds!: string[];

  @IsInt()
  @Min(10)
  @Max(3600)
  durationSeconds!: number;
}
