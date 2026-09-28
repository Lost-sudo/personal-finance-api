import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not configured');
}

const adapter = new PrismaPg({ connectionString });

const prisma = new PrismaClient({ adapter });

async function main() {
  const user = await prisma.user.upsert({
    where: {
      email: 'dev@example.com',
    },
    update: {},
    create: {
      email: 'dev@example.com',
      passwordHash: 'development-only',
      firstName: 'Development',
      lastName: 'User',
      defaultCurrency: 'PHP',
      isActive: true,
    },
  });

  console.log(`Development user: ${user.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });