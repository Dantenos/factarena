import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Service Prisma partagé : encapsule la connexion à PostgreSQL. On l'injecte
// dans les autres services pour accéder à la base. DATABASE_URL vient de l'env.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  // Ouvre la connexion au démarrage du module (plutôt qu'à la 1re requête).
  async onModuleInit() {
    await this.$connect();
  }
}
