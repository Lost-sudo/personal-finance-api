export default () => ({
  app: {
    name: 'Personal Finance API',
    environment: process.env.APP_ENV ?? 'development',
    nodeEnvironment: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_ACCESS_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  },
});
