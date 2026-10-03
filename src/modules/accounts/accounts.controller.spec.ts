import { Test, TestingModule } from '@nestjs/testing';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

describe('AccountsController', () => {
  let controller: AccountsController;

  const accountsServiceMock = {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [
        {
          provide: AccountsService,
          useValue: accountsServiceMock,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AccountsController>(AccountsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should forward the authenticated user id when creating an account', async () => {
    const user = { id: 'user-1' };
    const dto = { name: 'BDO Savings', type: 'BANK' } as never;
    const created = { id: 'account-1', userId: 'user-1' };

    accountsServiceMock.create.mockResolvedValue(created);

    const result = await controller.create(dto, user);

    expect(accountsServiceMock.create).toHaveBeenCalledWith('user-1', dto);
    expect(result).toMatchObject({ success: true, data: created });
  });

  it('should forward the authenticated user id when reading accounts', async () => {
    const user = { id: 'user-1' };
    const query = {
      page: 1,
      limit: 20,
      sortBy: 'name',
      sortOrder: 'asc',
    } as never;

    accountsServiceMock.findAll.mockResolvedValue({
      accounts: [],
      total: 0,
    });
    accountsServiceMock.findOne.mockResolvedValue({ id: 'account-1' });

    await controller.findAll(query, user);
    expect(accountsServiceMock.findAll).toHaveBeenCalledWith('user-1', query);

    await controller.findOne('account-1', user);
    expect(accountsServiceMock.findOne).toHaveBeenCalledWith(
      'user-1',
      'account-1',
    );
  });

  it('should forward the authenticated user id when mutating accounts', async () => {
    const user = { id: 'user-1' };

    accountsServiceMock.update.mockResolvedValue({ id: 'account-1' });
    accountsServiceMock.archive.mockResolvedValue({ id: 'account-1' });

    await controller.update('account-1', { name: 'BDO Checking' } as never, user);
    expect(accountsServiceMock.update).toHaveBeenCalledWith(
      'user-1',
      'account-1',
      { name: 'BDO Checking' },
    );

    await controller.archive('account-1', user);
    expect(accountsServiceMock.archive).toHaveBeenCalledWith(
      'user-1',
      'account-1',
    );
  });
});
