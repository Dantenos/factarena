import { ArrayMinSize, IsArray, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { CUID_PATTERN } from '../../common/pipes/cuid-param.pipe';

export class CreateRoundDto {
  @Matches(CUID_PATTERN)
  roomId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @Matches(CUID_PATTERN, { each: true })
  claimIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(20)
  claimCount?: number;

  @IsInt()
  @Min(10)
  @Max(3600)
  durationSeconds!: number;
}
