import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { UsersService } from '../../users/users.service.js';

function createGuardContext(headers: Record<string, string | undefined>) {
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

describe('JwtAuthGuard', () => {
  const jwtServiceMock = {
    verifyAsync: vi.fn(),
  };

  const configServiceMock = {
    getOrThrow: vi.fn().mockReturnValue('test-secret'),
  };

  const usersServiceMock = {
    findById: vi.fn(),
  };

  let guard: JwtAuthGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.getOrThrow.mockReturnValue('test-secret');

    guard = new JwtAuthGuard(
      jwtServiceMock as unknown as JwtService,
      configServiceMock as unknown as ConfigService,
      usersServiceMock as unknown as UsersService,
    );
  });

  it('should activate and attach the user for a valid token and active user', async () => {
    const { request, context } = createGuardContext({
      authorization: 'Bearer valid-token',
    });

    jwtServiceMock.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    usersServiceMock.findById.mockResolvedValue({
      id: 'user-1',
      isActive: true,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1' });
    expect(usersServiceMock.findById).toHaveBeenCalledWith('user-1');
  });

  it('should reject requests without an authorization header', async () => {
    const { context } = createGuardContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should reject requests with a malformed authorization header', async () => {
    const { context } = createGuardContext({ authorization: 'Token abc' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should reject invalid or expired tokens', async () => {
    const { context } = createGuardContext({
      authorization: 'Bearer invalid-token',
    });

    jwtServiceMock.verifyAsync.mockRejectedValue(new Error('invalid'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should reject tokens for deleted or inactive users', async () => {
    const { context } = createGuardContext({
      authorization: 'Bearer valid-token',
    });

    jwtServiceMock.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    usersServiceMock.findById.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );

    const { context: inactiveContext } = createGuardContext({
      authorization: 'Bearer valid-token',
    });

    usersServiceMock.findById.mockResolvedValue({
      id: 'user-1',
      isActive: false,
    });

    await expect(guard.canActivate(inactiveContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
