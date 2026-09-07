import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

export const CUID_PATTERN = /^c[a-z0-9]{24}$/;

@Injectable()
export class CuidParamPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (typeof value !== 'string' || !CUID_PATTERN.test(value)) {
      throw new BadRequestException('Identifiant invalide');
    }
    return value;
  }
}
