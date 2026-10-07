import { ArgumentsHost, Logger } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter.js';
import { Prisma } from '../../generated/prisma/client.js';

const PASSWORD = 'Super-Secret-Password-1';
const ACCESS_TOKEN = 'secret-access-token-value';
const REFRESH_TOKEN = 'secret-refresh-token-value';

function hostileHost() {
  const req = {
    method: 'POST',
    originalUrl: '/api/v1/auth/login',
    body: { email: 'john@example.com', password: PASSWORD },
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      cookie: `refresh_token=${REFRESH_TOKEN}`,
    },
  };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as never as ArgumentsHost;

  return { req, res, host };
}

function loggedText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.flat().map(String).join('\n');
}

/**
 * Sensitive-logging audit: request bodies, credentials, and tokens must
 * never reach the logger. Only method + route metadata may be logged.
 */
describe('GlobalExceptionFilter logging', () => {
  let filter: GlobalExceptionFilter;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs unhandled errors without request secrets', () => {
    const { res, host } = hostileHost();

    filter.catch(new Error('boom'), host);

    expect(res.status).toHaveBeenCalledWith(500);
    const text = loggedText(errorSpy);
    expect(text).toContain('POST /api/v1/auth/login');
    for (const secret of [PASSWORD, ACCESS_TOKEN, REFRESH_TOKEN]) {
      expect(text).not.toContain(secret);
    }
    const body = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      success: false,
      statusCode: 500,
      message: 'Internal server error',
    });
    const serialized = JSON.stringify(body);
    for (const secret of [PASSWORD, ACCESS_TOKEN, REFRESH_TOKEN]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('logs unknown Prisma errors without request secrets', () => {
    const { res, host } = hostileHost();

    filter.catch(
      new Prisma.PrismaClientUnknownRequestError('connection failed', {
        clientVersion: 'test',
      }),
      host,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    const text = loggedText(errorSpy);
    for (const secret of [PASSWORD, ACCESS_TOKEN, REFRESH_TOKEN]) {
      expect(text).not.toContain(secret);
    }
  });

  it('maps known Prisma errors without logging the request', () => {
    const { res, host } = hostileHost();

    filter.catch(
      new Prisma.PrismaClientKnownRequestError('not found', {
        code: 'P2025',
        clientVersion: 'test',
      }),
      host,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
