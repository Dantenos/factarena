import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

// Point d'entrée de l'API. On y branche les réglages GLOBAUX (préfixe, validation).
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Préfixe global : toutes les routes vivent sous /api. nginx conserve ce
  // préfixe (il proxifie /api/ -> backend:3000), donc l'URL publique est
  // https://localhost/api/... (ex. la sonde de santé est à /api/health).
  app.setGlobalPrefix('api');

  // Validation GLOBALE des DTO (exigence du sujet : valider les entrées côté
  // back). whitelist:true retire les champs non déclarés dans le DTO ;
  // transform:true convertit les payloads reçus en instances typées.
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // 0.0.0.0 : indispensable en conteneur pour être joignable par nginx.
  await app.listen(3000, '0.0.0.0');
}
bootstrap();
