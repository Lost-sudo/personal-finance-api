import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsController } from './transactions.controller.js';
import { TransactionsService } from './transactions.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

describe('TransactionsController', () => {
  let controller: TransactionsController;

  const transactionsServiceMock = {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        {
          provide: TransactionsService,
          useValue: transactionsServiceMock,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TransactionsController>(TransactionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should forward the authenticated user id when creating a transaction', async () => {
    const user = { id: 'user-1' };
    const dto = {
      type: 'EXPENSE',
      amount: 2500,
      transactionDate: '2026-01-15T08:30:00.000Z',
      description: 'Grocery run',
      accountId: 'account-1',
      categoryId: 'category-1',
    } as never;
    const created = { id: 'transaction-1', userId: 'user-1' };

    transactionsServiceMock.create.mockResolvedValue(created);

    const result = await controller.create(dto, user);

    expect(transactionsServiceMock.create).toHaveBeenCalledWith('user-1', dto);
    expect(result).toMatchObject({ success: true, data: created });
  });

  it('should forward the authenticated user id when reading transactions', async () => {
    const user = { id: 'user-1' };
    const query = {
      page: 1,
      limit: 20,
      sortBy: 'transactionDate',
      sortOrder: 'desc',
    } as never;

    const transactions = [{ id: 'transaction-1' }];
    transactionsServiceMock.findAll.mockResolvedValue({
      transactions,
      total: 21,
    });
    transactionsServiceMock.findOne.mockResolvedValue({
      id: 'transaction-1',
    });

    const listResult = await controller.findAll(query, user);
    expect(transactionsServiceMock.findAll).toHaveBeenCalledWith(
      'user-1',
      query,
    );
    expect(listResult).toMatchObject({
      success: true,
      data: transactions,
      meta: { page: 1, limit: 20, total: 21, totalPages: 2 },
    });

    const oneResult = await controller.findOne('transaction-1', user);
    expect(transactionsServiceMock.findOne).toHaveBeenCalledWith(
      'user-1',
      'transaction-1',
    );
    expect(oneResult).toMatchObject({
      success: true,
      data: { id: 'transaction-1' },
    });
  });

  it('should forward the authenticated user id when mutating transactions', async () => {
    const user = { id: 'user-1' };

    transactionsServiceMock.update.mockResolvedValue({
      id: 'transaction-1',
    });
    transactionsServiceMock.archive.mockResolvedValue(undefined);

    const updateResult = await controller.update(
      'transaction-1',
      { description: 'Updated grocery run' } as never,
      user,
    );
    expect(transactionsServiceMock.update).toHaveBeenCalledWith(
      'user-1',
      'transaction-1',
      { description: 'Updated grocery run' },
    );
    expect(updateResult).toMatchObject({
      success: true,
      data: { id: 'transaction-1' },
    });

    const archiveResult = await controller.archive('transaction-1', user);
    expect(transactionsServiceMock.archive).toHaveBeenCalledWith(
      'user-1',
      'transaction-1',
    );
    expect(archiveResult).toBeUndefined();
  });
});
