import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type CategoryQueryDto,
  categoryQuerySchema,
} from './dto/category-query.dto.js';
import {
  paginatedResponse,
  successResponse,
} from '../../common/utils/api-response.js';
import {
  apiResponseSchema,
  categorySchema,
  conflictErrorSchema,
  notFoundErrorSchema,
  paginatedResponseSchema,
  validationErrorSchema,
} from '../../common/swagger/api-response.schema.js';

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
    schema: apiResponseSchema(categorySchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid category data.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 409,
    description: 'A category with the same name and type already exists.',
    schema: conflictErrorSchema,
  })
  @Post()
  async create(
    @Body(new ZodValidationPipe(createCategorySchema))
    dto: CreateCategoryDto,
  ) {
    const category = await this.categoriesService.create(
      DEVELOPMENT_USER_ID,
      dto,
    );

    return successResponse(category);
  }

  @ApiOperation({
    summary: 'List categories',
    description: 'Returns all active categories belonging to the current user.',
  })
  @ApiQuery({
    name: 'page',
    description: 'Page number to retrieve.',
    type: Number,
    minimum: 1,
    default: 1,
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    description: 'Number of categories per page.',
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  })
  @ApiQuery({
    name: 'type',
    description: 'Filter categories by type.',
    enum: ['INCOME', 'EXPENSE'],
    required: false,
    example: 'EXPENSE',
  })
  @ApiQuery({
    name: 'search',
    description: 'Case-insensitive partial match on the category name.',
    type: String,
    minLength: 1,
    maxLength: 100,
    required: false,
    example: 'Food',
  })
  @ApiQuery({
    name: 'sortBy',
    description: 'Field used to order the results.',
    enum: ['name', 'createdAt'],
    default: 'name',
    example: 'name',
  })
  @ApiQuery({
    name: 'sortOrder',
    description: 'Sort direction.',
    enum: ['asc', 'desc'],
    default: 'asc',
    example: 'asc',
  })
  @ApiResponse({
    status: 200,
    description: 'Categories successfully retrieved.',
    schema: paginatedResponseSchema(categorySchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters.',
    schema: validationErrorSchema,
  })
  @Get()
  async findAll(
    @Query(new ZodValidationPipe(categoryQuerySchema)) query: CategoryQueryDto,
  ) {
    const result = await this.categoriesService.findAll(
      DEVELOPMENT_USER_ID,
      query,
    );

    const totalPages = Math.ceil(result.total / query.limit);

    return paginatedResponse(result.categories, {
      page: query.page,
      limit: query.limit,
      total: result.total,
      totalPages,
    });
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
    schema: apiResponseSchema(categorySchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid category id.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found.',
    schema: notFoundErrorSchema,
  })
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.categoriesService.findOne(
      DEVELOPMENT_USER_ID,
      id,
    );

    return successResponse(result);
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
    schema: apiResponseSchema(categorySchema),
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid category data.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found.',
    schema: notFoundErrorSchema,
  })
  @ApiResponse({
    status: 409,
    description: 'A category with the same name and type already exists.',
    schema: conflictErrorSchema,
  })
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCategorySchema))
    dto: UpdateCategoryDto,
  ) {
    const result = await this.categoriesService.update(
      DEVELOPMENT_USER_ID,
      id,
      dto,
    );

    return successResponse(result);
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
    status: 204,
    description: 'Category successfully archived. No response body.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid category id.',
    schema: validationErrorSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found.',
    schema: notFoundErrorSchema,
  })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@Param('id', ParseUUIDPipe) id: string) {
    await this.categoriesService.archive(DEVELOPMENT_USER_ID, id);
  }
}
