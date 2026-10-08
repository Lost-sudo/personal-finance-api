import { Test, TestingModule } from '@nestjs/testing';
import { BudgetsController } from './budgets.controller.js';
import { BudgetsService } from './budgets.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

describe('BudgetsController', () => {
  let controller: BudgetsController;

  const budgetsServiceMock = {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    getProgress: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BudgetsController],
      providers: [
        {
          provide: BudgetsService,
          useValue: budgetsServiceMock,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BudgetsController>(BudgetsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should forward the authenticated user id when creating a budget', async () => {
    const user = { id: 'user-1' };
    const dto = {
      name: 'October Food Budget',
      categoryId: '550e8400-e29b-41d4-a716-446655440000',
      amount: 10000,
      period: 'MONTHLY',
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: '2026-10-31T23:59:59.000Z',
    } as never;
    const created = { id: 'budget-1', userId: 'user-1' };

    budgetsServiceMock.create.mockResolvedValue(created);

    const result = await controller.create(dto, user);

    expect(budgetsServiceMock.create).toHaveBeenCalledWith('user-1', dto);
    expect(result).toMatchObject({ success: true, data: created });
  });

  it('should forward the authenticated user id when reading budgets', async () => {
    const user = { id: 'user-1' };
    const query = {
      page: 1,
      limit: 20,
      sortBy: 'startDate',
      sortOrder: 'desc',
    } as never;

    budgetsServiceMock.findAll.mockResolvedValue({ budgets: [], total: 0 });
    budgetsServiceMock.findOne.mockResolvedValue({ id: 'budget-1' });

    await controller.findAll(query, user);
    expect(budgetsServiceMock.findAll).toHaveBeenCalledWith('user-1', query);

    await controller.findOne('budget-1', user);
    expect(budgetsServiceMock.findOne).toHaveBeenCalledWith(
      'user-1',
      'budget-1',
    );
  });

  it('should forward the authenticated user id when mutating budgets', async () => {
    const user = { id: 'user-1' };

    budgetsServiceMock.update.mockResolvedValue({ id: 'budget-1' });
    budgetsServiceMock.remove.mockResolvedValue({ id: 'budget-1' });

    await controller.update('budget-1', { name: 'Updated' } as never, user);
    expect(budgetsServiceMock.update).toHaveBeenCalledWith(
      'user-1',
      'budget-1',
      { name: 'Updated' },
    );

    const result = await controller.remove('budget-1', user);
    expect(budgetsServiceMock.remove).toHaveBeenCalledWith(
      'user-1',
      'budget-1',
    );
    expect(result).toBeUndefined();
  });

  it('should forward the authenticated user id when reading progress', async () => {
    const user = { id: 'user-1' };
    const progress = { id: 'budget-1', status: 'ON_TRACK' };

    budgetsServiceMock.getProgress.mockResolvedValue(progress);

    const result = await controller.getProgress('budget-1', user);

    expect(budgetsServiceMock.getProgress).toHaveBeenCalledWith(
      'user-1',
      'budget-1',
    );
    expect(result).toMatchObject({ success: true, data: progress });
  });
});
