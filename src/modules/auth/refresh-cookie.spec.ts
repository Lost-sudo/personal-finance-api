import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { refreshSchema } from './dto/refresh.dto.js';
import { parseDurationMs } from './refresh-token.service.js';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  clearRefreshCookieOptions,
  refreshCookieOptions,
} from './refresh-cookie.js';

describe('Refresh token hardening primitives', () => {
  describe('parseDurationMs', () => {
    it('parses the supported JWT duration suffixes', () => {
      expect(parseDurationMs('30s')).toBe(30_000);
      expect(parseDurationMs('15m')).toBe(900_000);
      expect(parseDurationMs('12h')).toBe(43_200_000);
      expect(parseDurationMs('7d')).toBe(604_800_000);
    });

    it('rejects anything outside the narrow duration format', () => {
      expect(() => parseDurationMs('3600')).toThrow();
      expect(() => parseDurationMs('15M')).toThrow();
      expect(() => parseDurationMs('soon')).toThrow();
    });
  });

  describe('refresh cookie options', () => {
    it('is always httpOnly, SameSite=strict, and scoped to auth routes', () => {
      for (const isProduction of [true, false]) {
        expect(refreshCookieOptions(isProduction, '7d')).toMatchObject({
          httpOnly: true,
          sameSite: 'strict',
          path: REFRESH_COOKIE_PATH,
        });
      }

      expect(REFRESH_COOKIE_NAME).toBe('refresh_token');
      expect(REFRESH_COOKIE_PATH).toBe('/api/v1/auth');
    });

    it('sets Secure only in production', () => {
      expect(refreshCookieOptions(true, '7d').secure).toBe(true);
      expect(refreshCookieOptions(false, '7d').secure).toBe(false);
    });

    it('clears with maxAge 0 on the same path', () => {
      expect(clearRefreshCookieOptions(true)).toMatchObject({
        httpOnly: true,
        path: REFRESH_COOKIE_PATH,
        maxAge: 0,
      });
    });
  });

  describe('refreshSchema', () => {
    it('accepts an empty body for cookie-only callers', () => {
      const result = new ZodValidationPipe(refreshSchema).transform(
        {},
        { type: 'body' },
      );

      expect(result).toEqual({});
    });

    it('accepts a body-carried token', () => {
      const result = new ZodValidationPipe(refreshSchema).transform(
        { refreshToken: 'opaque-token' },
        { type: 'body' },
      ) as { refreshToken?: string };

      expect(result.refreshToken).toBe('opaque-token');
    });

    it('rejects unexpected fields', () => {
      expect(() =>
        new ZodValidationPipe(refreshSchema).transform(
          { refreshToken: 'x', userId: 'attacker-chosen' },
          { type: 'body' },
        ),
      ).toThrow(BadRequestException);
    });
  });
});
