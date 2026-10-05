import { Test, TestingModule } from '@nestjs/testing';
import { RecurringTransactionsController } from './recurring-transactions.controller.js';
import { RecurringTransactionsService } from './recurring-transactions.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

describe('RecurringTransactionsController', () => {
  let controller: RecurringTransactionsController;

  const recurringTransactionsServiceMock = {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecurringTransactionsController],
      providers: [
        {
          provide: RecurringTransactionsService,
          useValue: recurringTransactionsServiceMock,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RecurringTransactionsController>(
      RecurringTransactionsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should forward the authenticated user id when creating a schedule', async () => {
    const user = { id: 'user-1' };
    const dto = {
      type: 'EXPENSE',
      amount: 2500,
      description: 'Monthly rent',
      accountId: 'account-1',
      categoryId: 'category-1',
      frequency: 'MONTHLY',
      nextRunAt: '2026-11-01T09:00:00.000Z',
    } as never;
    const created = { id: 'recurring-1', userId: 'user-1' };

    recurringTransactionsServiceMock.create.mockResolvedValue(created);

    const result = await controller.create(dto, user);

    expect(recurringTransactionsServiceMock.create).toHaveBeenCalledWith(
      'user-1',
      dto,
    );
    expect(result).toMatchObject({ success: true, data: created });
  });

  it('should forward the authenticated user id when reading schedules', async () => {
    const user = { id: 'user-1' };
    const query = {
      page: 1,
      limit: 20,
      sortBy: 'nextRunAt',
      sortOrder: 'asc',
    } as never;

    const schedules = [{ id: 'recurring-1' }];
    recurringTransactionsServiceMock.findAll.mockResolvedValue({
      recurringTransactions: schedules,
      total: 21,
    });
    recurringTransactionsServiceMock.findOne.mockResolvedValue({
      id: 'recurring-1',
    });

    const listResult = await controller.findAll(query, user);
    expect(recurringTransactionsServiceMock.findAll).toHaveBeenCalledWith(
      'user-1',
      query,
    );
    expect(listResult).toMatchObject({
      success: true,
      data: schedules,
      meta: { page: 1, limit: 20, total: 21, totalPages: 2 },
    });

    const oneResult = await controller.findOne('recurring-1', user);
    expect(recurringTransactionsServiceMock.findOne).toHaveBeenCalledWith(
      'user-1',
      'recurring-1',
    );
    expect(oneResult).toMatchObject({
      success: true,
      data: { id: 'recurring-1' },
    });
  });

  it('should forward the authenticated user id when mutating schedules', async () => {
    const user = { id: 'user-1' };

    recurringTransactionsServiceMock.update.mockResolvedValue({
      id: 'recurring-1',
    });
    recurringTransactionsServiceMock.remove.mockResolvedValue(undefined);

    const updateResult = await controller.update(
      'recurring-1',
      { description: 'Updated rent', isActive: false } as never,
      user,
    );
    expect(recurringTransactionsServiceMock.update).toHaveBeenCalledWith(
      'user-1',
      'recurring-1',
      { description: 'Updated rent', isActive: false },
    );
    expect(updateResult).toMatchObject({
      success: true,
      data: { id: 'recurring-1' },
    });

    const removeResult = await controller.remove('recurring-1', user);
    expect(recurringTransactionsServiceMock.remove).toHaveBeenCalledWith(
      'user-1',
      'recurring-1',
    );
    expect(removeResult).toBeUndefined();
  });
});
