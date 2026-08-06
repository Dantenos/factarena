export const isProduction = process.env.NODE_ENV === 'production';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    if (isProduction) {
      throw new Error('JWT_SECRET is required in production');
    }
    return 'dev-secret-change-me';
  }
  return secret;
}

export function isFortyTwoEnabled(): boolean {
  return Boolean(
    process.env.FORTYTWO_CLIENT_ID?.trim() &&
    process.env.FORTYTWO_CLIENT_SECRET?.trim(),
  );
}

export function getFortyTwoClientId(): string {
  const value = process.env.FORTYTWO_CLIENT_ID?.trim();
  if (!value) {
    throw new Error('FORTYTWO_CLIENT_ID is required for OAuth 42');
  }
  return value;
}

export function getFortyTwoClientSecret(): string {
  const value = process.env.FORTYTWO_CLIENT_SECRET?.trim();
  if (!value) {
    throw new Error('FORTYTWO_CLIENT_SECRET is required for OAuth 42');
  }
  return value;
}

export function getFortyTwoCallbackUrl(): string {
  return process.env.FORTYTWO_CALLBACK_URL?.trim() || 'http://localhost:3000/api/auth/42/callback';
}

export function getFrontendCallbackUrl(token: string): string | null {
  const frontendUrl = process.env.FRONTEND_URL?.trim();
  if (!frontendUrl) {
    return null;
  }
  return `${frontendUrl.replace(/\/$/, '')}/auth/callback?token=${encodeURIComponent(token)}`;
}
