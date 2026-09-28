import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateCategoryDto) {
    const existingCategory = await this.prisma.category.findUnique({
      where: {
        userId_name_type: {
          userId,
          name: dto.name,
          type: dto.type,
        },
      },
    });

    if (existingCategory) {
      throw new ConflictException(
        'A category with this name and type already exists',
      );
    }

    return this.prisma.category.create({
      data: {
        userId,
        name: dto.name,
        type: dto.type,
        color: dto.color,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.category.findMany({
      where: {
        userId,
        isArchived: false,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(userId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: {
        id,
        userId,
        isArchived: false,
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async update(userId: string, id: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.category.findFirst({
      where: {
        id,
        userId,
        isArchived: false,
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const name = dto.name ?? category.name;
    const type = dto.type ?? category.type;

    const duplicate = await this.prisma.category.findFirst({
      where: {
        userId,
        name,
        type,
        isArchived: false,
        NOT: {
          id,
        },
      },
    });

    if (duplicate) {
      throw new ConflictException(
        'A category with this name and type already exists',
      );
    }

    return this.prisma.category.update({
      where: {
        id,
      },
      data: {
        ...dto,
      },
    });
  }

  async archive(userId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: {
        id,
        userId,
        isArchived: false,
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return this.prisma.category.update({
      where: {
        id,
      },
      data: {
        isArchived: true,
      },
    });
  }
}
