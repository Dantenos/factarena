import { IsOptional, IsString, IsUrl, Length, MaxLength, ValidateIf } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 30, { message: 'Le pseudo doit faire entre 2 et 30 caractères.' })
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @ValidateIf((dto: UpdateProfileDto) => dto.avatarUrl !== '')
  @IsUrl({ require_tld: false })
  avatarUrl?: string;
}
