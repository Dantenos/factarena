import { Controller, Get } from '@nestjs/common';

// Sonde de santé. Avec le préfixe global 'api', la route exposée est
// GET /api/health. Elle est utilisée par le healthcheck Docker ET par la page
// d'accueil du front (pour vérifier la chaîne front -> nginx -> back).
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
