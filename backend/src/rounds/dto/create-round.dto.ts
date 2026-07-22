import { ArrayMinSize, IsArray, IsInt, IsString, Max, Min } from 'class-validator';

export class CreateRoundDto {
  @IsString()
  roomId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  claimIds!: string[];

  @IsInt()
  @Min(10)
  @Max(3600)
  durationSeconds!: number;
}
