import { IsNotEmpty, IsOptional, IsString, IsArray } from 'class-validator';

export class ModerationRequestDto {
  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  history?: string[];
}
