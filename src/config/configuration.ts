export default () => ({
  app: {
    name: 'Personal Finance API',
    environment: process.env.APP_ENV ?? 'development',
    nodeEnvironment: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
  },
});
