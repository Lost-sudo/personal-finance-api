import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { UsersService } from '../../users/users.service.js';

const ACCESS_SECRET = 'token-spec-access-secret-key-32-chars';
const OTHER_SECRET = 'token-spec-other-secret-key-32-chars!!';

function createContext(headers: Record<string, string | undefined>) {
  const request: { headers: typeof headers; user?: { id: string } } = {
    headers,
  };

  return {
    request,
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as never,
  };
}

/**
 * Guard coverage against real JWTs: validity, expiry, signature, payload
 * shape, and missing configuration. The mock-based spec covers plumbing;
 * this one proves cryptographic behavior end to end.
 */
describe('JwtAuthGuard (real tokens)', () => {
  const usersServiceMock = {
    findById: vi.fn(),
  };

  const configServiceMock = {
    getOrThrow: vi.fn((key: string) => {
      if (key === 'jwt.secret') {
        return ACCESS_SECRET;
      }

      throw new Error(`missing ${key}`);
    }),
  };

  let jwtService: JwtService;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    vi.clearAllMocks();

    jwtService = new JwtService({ secret: ACCESS_SECRET });
    usersServiceMock.findById.mockResolvedValue({
      id: 'user-1',
      isActive: true,
    });

    guard = new JwtAuthGuard(
      jwtService,
      configServiceMock as unknown as ConfigService,
      usersServiceMock as unknown as UsersService,
    );
  });

  it('accepts a valid short-lived access token', async () => {
    const token = await jwtService.signAsync(
      { sub: 'user-1' },
      { expiresIn: '15m' },
    );
    const { request, context } = createContext({
      authorization: `Bearer ${token}`,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1' });
  });

  it('rejects an expired access token', async () => {
    const expired = await new JwtService({ secret: ACCESS_SECRET }).signAsync(
      {
        sub: 'user-1',
        exp: Math.floor(Date.now() / 1000) - 60,
      },
    );
    const { context } = createContext({
      authorization: `Bearer ${expired}`,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired access token',
    );
  });

  it('rejects a token with an invalid signature', async () => {
    const forged = await new JwtService({ secret: OTHER_SECRET }).signAsync({
      sub: 'user-1',
    });
    const { context } = createContext({
      authorization: `Bearer ${forged}`,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired access token',
    );
  });

  it('rejects tokens without a subject', async () => {
    const subjectless = await jwtService.signAsync({ role: 'admin' });
    const { context } = createContext({
      authorization: `Bearer ${subjectless}`,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects missing and malformed authorization headers', async () => {
    const { context: missing } = createContext({});

    await expect(guard.canActivate(missing)).rejects.toThrow(
      'Missing or invalid access token',
    );

    const { context: malformed } = createContext({
      authorization: 'Token abc',
    });

    await expect(guard.canActivate(malformed)).rejects.toThrow(
      'Missing or invalid access token',
    );
  });

  it('rejects valid tokens for inactive users', async () => {
    const token = await jwtService.signAsync({ sub: 'user-1' });
    const { context } = createContext({
      authorization: `Bearer ${token}`,
    });

    usersServiceMock.findById.mockResolvedValue({
      id: 'user-1',
      isActive: false,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('fails closed when JWT configuration is missing', async () => {
    const token = await jwtService.signAsync({ sub: 'user-1' });
    const { context } = createContext({
      authorization: `Bearer ${token}`,
    });

    configServiceMock.getOrThrow.mockImplementation(() => {
      throw new Error('missing jwt.secret');
    });

    // The guard never grants access without configuration; the config error
    // is masked as a generic 401 so no internals leak to the client.
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired access token',
    );
  });
});
