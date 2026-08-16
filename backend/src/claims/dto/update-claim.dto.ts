import { IsEnum, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';
import { ClaimTruthLabel } from './create-claim.dto';

export class UpdateClaimDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  mediaRef?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  videoEndS?: number;

  @IsOptional()
  @IsEnum(ClaimTruthLabel)
  truthLabel?: ClaimTruthLabel;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  sourceUrl?: string;
}
