import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @IsEmail({}, { message: 'Email must be a valid email address.' })
  @IsNotEmpty({ message: 'Email is required.' })
  @MaxLength(254)
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long.' })
  @MaxLength(128, { message: 'Password must be at most 128 characters long.' })
  @IsNotEmpty({ message: 'Password is required.' })
  password!: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Email must be a valid email address.' })
  @IsNotEmpty({ message: 'Email is required.' })
  @MaxLength(254)
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long.' })
  @MaxLength(128, { message: 'Password must be at most 128 characters long.' })
  @IsNotEmpty({ message: 'Password is required.' })
  password!: string;
}
