import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CategoriesService } from './categories.service.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  type CreateCategoryDto,
  createCategorySchema,
} from './dto/create-category.dto.js';
import {
  type UpdateCategoryDto,
  updateCategorySchema,
} from './dto/update-category.dto.js';
import { DEVELOPMENT_USER_ID } from '../../common/constants/development-user.js';

import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @ApiOperation({
    summary: 'Create a category',
    description:
      'Creates a new income or expense category for the current user.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'type'],
      properties: {
        name: {
          type: 'string',
          example: 'Food',
          description: 'Category name.',
          minLength: 1,
          maxLength: 100,
        },
        type: {
          type: 'string',
          enum: ['INCOME', 'EXPENSE'],
          example: 'EXPENSE',
        },
        color: {
          type: 'string',
          example: '#FF9800',
          description: 'Optional display color.',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Category successfully created.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid category data.',
  })
  @ApiResponse({
    status: 409,
    description: 'A category with the same name and type already exists.',
  })
  @Post()
  create(
    @Body(new ZodValidationPipe(createCategorySchema))
    dto: CreateCategoryDto,
  ) {
    const userId = DEVELOPMENT_USER_ID;

    return this.categoriesService.create(userId, dto);
  }

  @ApiOperation({
    summary: 'List categories',
    description: 'Returns all active categories belonging to the current user.',
  })
  @ApiResponse({
    status: 200,
    description: 'Categories successfully retrieved.',
  })
  @Get()
  findAll() {
    const userId = DEVELOPMENT_USER_ID;

    return this.categoriesService.findAll(userId);
  }

  @ApiOperation({
    summary: 'Get a category',
    description: 'Returns one active category belonging to the current user.',
  })
  @ApiParam({
    name: 'id',
    description: 'Category UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Category successfully retrieved.',
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found.',
  })
  @Get(':id')
  findOne(@Param('id') id: string) {
    const userId = DEVELOPMENT_USER_ID;

    return this.categoriesService.findOne(userId, id);
  }

  @ApiOperation({
    summary: 'Update a category',
    description:
      'Updates an existing active category belonging to the current user.',
  })
  @ApiParam({
    name: 'id',
    description: 'Category UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          example: 'Groceries',
          minLength: 1,
          maxLength: 100,
        },
        type: {
          type: 'string',
          enum: ['INCOME', 'EXPENSE'],
          example: 'EXPENSE',
        },
        color: {
          type: 'string',
          example: '#4CAF50',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Category successfully updated.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid category data.',
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found.',
  })
  @ApiResponse({
    status: 409,
    description: 'A category with the same name and type already exists.',
  })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCategorySchema))
    dto: UpdateCategoryDto,
  ) {
    const userId = DEVELOPMENT_USER_ID;

    return this.categoriesService.update(userId, id, dto);
  }

  @ApiOperation({
    summary: 'Archive a category',
    description: 'Archives a category instead of permanently deleting it.',
  })
  @ApiParam({
    name: 'id',
    description: 'Category UUID.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Category successfully archived.',
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found.',
  })
  @Delete(':id')
  archive(@Param('id') id: string) {
    const userId = DEVELOPMENT_USER_ID;

    return this.categoriesService.archive(userId, id);
  }
}
