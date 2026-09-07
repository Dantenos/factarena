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
  const clientId = process.env.FORTYTWO_CLIENT_ID?.trim();
  const clientSecret = process.env.FORTYTWO_CLIENT_SECRET?.trim();
  const callbackUrl = process.env.FORTYTWO_CALLBACK_URL?.trim();

  if (!clientId || !clientSecret || !callbackUrl) return false;

  try {
    const parsed = new URL(callbackUrl);
    const expectedPath = '/api/auth/42/callback';
    if (parsed.pathname !== expectedPath) return false;
    if (isProduction && parsed.protocol !== 'https:') return false;
    return true;
  } catch {
    return false;
  }
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
  const value = process.env.FORTYTWO_CALLBACK_URL?.trim();
  if (!value) {
      throw new Error('FORTYTWO_CALLBACK_URL is required for OAuth 42');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
      throw new Error('FORTYTWO_CALLBACK_URL must be an absolute URL');
  }

  if (parsed.pathname !== '/api/auth/42/callback') {
      throw new Error('FORTYTWO_CALLBACK_URL must target /api/auth/42/callback');
  }
  if (isProduction && parsed.protocol !== 'https:') {
      throw new Error('FORTYTWO_CALLBACK_URL must use HTTPS in production');
  }

  return parsed.toString().replace(/\/$/, '');
}

export function getFrontendCallbackUrl(token: string): string | null {
  const frontendUrl = process.env.FRONTEND_URL?.trim();
  if (!frontendUrl) {
    return null;
  }
  return `${frontendUrl.replace(/\/$/, '')}/auth/callback?token=${encodeURIComponent(token)}`;
}
