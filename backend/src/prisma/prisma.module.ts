import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global : le PrismaService devient disponible dans toute l'app sans avoir à
// réimporter PrismaModule dans chaque module de feature.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
