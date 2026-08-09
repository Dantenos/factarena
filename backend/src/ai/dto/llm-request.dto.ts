import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class MessagePayloadDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['system', 'user', 'assistant'])
  role!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;
}

export class LlmRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  prompt!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MessagePayloadDto)
  messages?: MessagePayloadDto[];
}
