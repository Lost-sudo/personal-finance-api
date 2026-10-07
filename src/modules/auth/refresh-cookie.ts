import type { CookieOptions } from 'express';
import { parseDurationMs } from './refresh-token.service.js';

export const REFRESH_COOKIE_NAME = 'refresh_token';

// Scoped to auth routes so browsers don't attach it to every call.
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function refreshCookieOptions(
  isProduction: boolean,
  refreshExpiresIn: string,
): CookieOptions {
  return {
    httpOnly: true,
    // Secure in production only; local dev uses plain HTTP.
    secure: isProduction,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: parseDurationMs(refreshExpiresIn),
  };
}

export function clearRefreshCookieOptions(
  isProduction: boolean,
): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
  };
}
