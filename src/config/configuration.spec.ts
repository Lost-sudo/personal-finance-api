import configuration from './configuration.js';

/** Locks in the Step-25 config contract (Swagger, CORS, JWT, throttles). */
describe('security configuration', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('enables Swagger outside production by default', () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_ENV = 'development';
    delete process.env.SWAGGER_ENABLED;

    expect(configuration().swagger.enabled).toBe(true);
  });

  it('disables Swagger in production unless explicitly enabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'production';
    delete process.env.SWAGGER_ENABLED;

    expect(configuration().swagger.enabled).toBe(false);

    process.env.SWAGGER_ENABLED = 'true';

    expect(configuration().swagger.enabled).toBe(true);
  });

  it('parses the CORS allowlist, empty when unconfigured', () => {
    delete process.env.CORS_ORIGIN;

    expect(configuration().cors.origin).toEqual([]);

    process.env.CORS_ORIGIN =
      'https://app.example.com, https://admin.example.com ';

    expect(configuration().cors.origin).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('exposes separate access/refresh secrets with short-lived defaults', () => {
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    delete process.env.JWT_EXPIRES_IN;
    delete process.env.JWT_REFRESH_EXPIRES_IN;

    const jwt = configuration().jwt;

    expect(jwt.secret).toBe('a'.repeat(32));
    expect(jwt.refreshSecret).toBe('b'.repeat(32));
    expect(jwt.refreshSecret).not.toBe(jwt.secret);
    expect(jwt.expiresIn).toBe('15m');
    expect(jwt.refreshExpiresIn).toBe('7d');
  });

  it('defaults throttle budgets to production values', () => {
    delete process.env.THROTTLE_DEFAULT_LIMIT;
    delete process.env.THROTTLE_DEFAULT_TTL;
    delete process.env.THROTTLE_AUTH_LIMIT;
    delete process.env.THROTTLE_AUTH_TTL;
    delete process.env.THROTTLE_AUTH_STRICT_LIMIT;
    delete process.env.THROTTLE_AUTH_STRICT_TTL;

    expect(configuration().throttle).toMatchObject({
      defaultLimit: 100,
      defaultTtl: 60000,
      authLimit: 10,
      authTtl: 60000,
      authStrictLimit: 5,
      authStrictTtl: 60000,
    });
  });
});
