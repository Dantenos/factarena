import { IsOptional, IsString, IsUrl, Length, MaxLength, ValidateIf } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @ValidateIf((dto: UpdateProfileDto) => dto.avatarUrl !== '')
  @IsUrl({ require_tld: false })
  avatarUrl?: string;
}
