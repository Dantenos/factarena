import { IsEmail, IsNotEmpty, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @IsString({ message: 'Le pseudo doit être valide.' })
  @IsNotEmpty({ message: 'Le pseudo est obligatoire.' })
  @Length(2, 30, { message: 'Le pseudo doit faire entre 2 et 30 caractères.' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  displayName!: string;

  @IsEmail({}, { message: 'L’adresse e-mail doit être valide.' })
  @IsNotEmpty({ message: 'L’adresse e-mail est obligatoire.' })
  @MaxLength(254, { message: 'L’adresse e-mail doit être valide.' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit contenir au moins 8 caractères.' })
  @MaxLength(128, { message: 'Le mot de passe doit contenir au maximum 128 caractères.' })
  @IsNotEmpty({ message: 'Le mot de passe est obligatoire.' })
  password!: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'L’adresse e-mail doit être valide.' })
  @IsNotEmpty({ message: 'L’adresse e-mail est obligatoire.' })
  @MaxLength(254, { message: 'L’adresse e-mail doit être valide.' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit contenir au moins 8 caractères.' })
  @MaxLength(128, { message: 'Le mot de passe doit contenir au maximum 128 caractères.' })
  @IsNotEmpty({ message: 'Le mot de passe est obligatoire.' })
  password!: string;
}
