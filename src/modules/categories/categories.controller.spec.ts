import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

describe('CategoriesController', () => {
  let controller: CategoriesController;

  const categoriesServiceMock = {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [
        {
          provide: CategoriesService,
          useValue: categoriesServiceMock,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CategoriesController>(CategoriesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should forward the authenticated user id when creating a category', async () => {
    const user = { id: 'user-1' };
    const dto = { name: 'Food', type: 'EXPENSE' } as never;
    const created = { id: 'category-1', userId: 'user-1' };

    categoriesServiceMock.create.mockResolvedValue(created);

    const result = await controller.create(dto, user);

    expect(categoriesServiceMock.create).toHaveBeenCalledWith('user-1', dto);
    expect(result).toMatchObject({ success: true, data: created });
  });

  it('should forward the authenticated user id when reading categories', async () => {
    const user = { id: 'user-1' };
    const query = {
      page: 1,
      limit: 20,
      sortBy: 'name',
      sortOrder: 'asc',
    } as never;

    categoriesServiceMock.findAll.mockResolvedValue({
      categories: [],
      total: 0,
    });
    categoriesServiceMock.findOne.mockResolvedValue({ id: 'category-1' });

    await controller.findAll(query, user);
    expect(categoriesServiceMock.findAll).toHaveBeenCalledWith('user-1', query);

    await controller.findOne('category-1', user);
    expect(categoriesServiceMock.findOne).toHaveBeenCalledWith(
      'user-1',
      'category-1',
    );
  });

  it('should forward the authenticated user id when mutating categories', async () => {
    const user = { id: 'user-1' };

    categoriesServiceMock.update.mockResolvedValue({ id: 'category-1' });
    categoriesServiceMock.archive.mockResolvedValue({ id: 'category-1' });

    await controller.update('category-1', { name: 'Groceries' } as never, user);
    expect(categoriesServiceMock.update).toHaveBeenCalledWith(
      'user-1',
      'category-1',
      { name: 'Groceries' },
    );

    await controller.archive('category-1', user);
    expect(categoriesServiceMock.archive).toHaveBeenCalledWith(
      'user-1',
      'category-1',
    );
  });
});
