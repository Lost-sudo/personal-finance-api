import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service.js';
import { PrismaService } from '../../database/prisma.service.js';

describe('UsersService', () => {
  let service: UsersService;

  const prismaMock = {
    user: {
      findUnique: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);

    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByEmail', () => {
    it('should find a user by email', async () => {
      const user = {
        id: 'user-123',
        email: 'john@example.com',
        passwordHard: 'hashed-password',
      };

      prismaMock.user.findUnique.mockResolvedValue(user);

      const result = await service.findByEmail('john@example.com');

      expect(result).toEqual(user);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: {
          email: 'john@example.com',
        },
      });
    });

    it('should return null when the user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail('unknown@example.com');

      expect(result).toBeNull();

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: {
          email: 'unknown@example.com',
        },
      });
    });

    it('should throw error when Prisma throws an error', async () => {
      prismaMock.user.findUnique.mockRejectedValue(new Error('Database error'));

      await expect(service.findByEmail('unknown@example.com')).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('findById', () => {
    it('should find a user by ID', async () => {
      const user = {
        id: 'user-123',
        email: 'john@example.com',
      };

      prismaMock.user.findUnique.mockResolvedValue(user);

      const result = await service.findById('user-123');

      expect(result).toEqual(user);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: {
          id: 'user-123',
        },
      });
    });

    it('should return null when the user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await service.findById('unknown-user-id');

      expect(result).toBeNull();

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: {
          id: 'unknown-user-id',
        },
      });
    });

    it('should throw error when Prisma throws an error', async () => {
      prismaMock.user.findUnique.mockRejectedValue(new Error('Database error'));

      await expect(service.findById('unknown-user-id')).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('create', () => {
    it('should create a user with the supplied data', async () => {
      const data = {
        email: 'john@example.com',
        passwordHash: 'hashed-password',
        firstName: 'John',
        lastName: 'Doe',
      };

      const createdUser = {
        id: 'user-123',
        ...data,
        isActive: true,
        emailVerifiedAt: null,
      };

      prismaMock.user.create.mockResolvedValue(createdUser);

      const result = await service.create(data);

      expect(result).toEqual(createdUser);

      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data,
      });
    });

    it('should throw error when Prisma throws an error', async () => {
      prismaMock.user.create.mockRejectedValue(new Error('Database error'));

      await expect(
        service.create({
          email: 'john@example.com',
          passwordHash: 'hashed-password',
          firstName: 'John',
          lastName: 'Doe',
        }),
      ).rejects.toThrow('Database error');
    });
  });
});
