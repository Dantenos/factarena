import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export enum ClaimTruthLabel {
  TRUE = 'TRUE',
  FALSE = 'FALSE',
}

export class CreateClaimDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  mediaRef?: string;

  @IsEnum(ClaimTruthLabel)
  truthLabel!: ClaimTruthLabel;

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
