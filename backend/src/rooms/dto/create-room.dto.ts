import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;
}
