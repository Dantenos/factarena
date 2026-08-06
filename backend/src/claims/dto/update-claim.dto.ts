import { IsEnum, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
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
