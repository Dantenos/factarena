import { ArrayMaxSize, IsNotEmpty, IsOptional, IsString, IsArray, MaxLength } from 'class-validator';

export class ModerationRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  @ArrayMaxSize(20)
  history?: string[];
}
