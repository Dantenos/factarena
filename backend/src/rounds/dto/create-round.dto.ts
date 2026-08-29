import { ArrayMinSize, IsArray, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { CUID_PATTERN } from '../../common/pipes/cuid-param.pipe';

export class CreateRoundDto {
  @Matches(CUID_PATTERN)
  roomId!: string;

  // claimIds devient OPTIONNEL. Jusqu'ici l'hôte devait fournir lui-même la
  // liste des identifiants de claims, ce qu'aucune interface ne peut faire :
  // il fallait les récupérer à la main avant de lancer une partie. Quand la
  // liste est absente, le serveur tire les claims lui-même (voir
  // RoundsService.tirerClaims). On garde la possibilité de les imposer, c'est
  // utile pour les tests et pour rejouer une manche identique.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @Matches(CUID_PATTERN, { each: true })
  claimIds?: string[];

  // Nombre de clips à tirer quand claimIds n'est pas fourni. Borné : en dessous
  // de 3 la manche n'a pas d'intérêt, au-delà de 20 elle devient interminable.
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(20)
  claimCount?: number;

  @IsInt()
  @Min(10)
  @Max(3600)
  durationSeconds!: number;
}
