# User Flow — Personal Finance API

> End-to-end guide covering all modules/services: what to do, in what order, and what happens internally.
> Base URL: `/api/v1` — Swagger: `/api/docs`

## 0. Boot Flow (what runs on `npm run start:dev`)

```text
src/main.ts:bootstrap()
 -> AppModule (src/app.module.ts)
    -> ConfigModule (Joi validation: DATABASE_URL, JWT_ACCESS_SECRET, PORT, cron vars)
    -> ScheduleModule.forRoot()
    -> DatabaseModule (PrismaService: src/database/prisma.service.ts)
    -> AuthModule, UsersModule, AccountsModule, CategoriesModule,
       TransactionsModule, RecurringTransactionsModule, ReportsModule
 -> configureApp(): setGlobalPrefix('api/v1') (src/app.setup.ts)
 -> SwaggerModule.setup('api/docs')
 -> useGlobalFilters(GlobalExceptionFilter)
 -> app.listen(port)
```

Every protected request goes through:

```text
Authorization: Bearer <jwt>
 -> JwtAuthGuard (src/modules/auth/guards/jwt-auth.guard.ts)
 -> ZodValidationPipe (src/common/pipes/zod-validation.pipe.ts)
 -> ParseUUIDPipe (:id params)
 -> Controller -> Service(userId, ...) -> Prisma
 -> successResponse() / paginatedResponse() (src/common/utils/api-response.ts)
 |  GlobalExceptionFilter (src/common/filters/global-exception.filter.ts)
```

Prisma models (`prisma/schema.prisma`):

```text
User 1--* Account, Category, Transaction, Budget, RecurringTransaction
Account 1--* Transaction + RecurringTransaction (x3 relations)
Category 1--* Transaction, Budget, RecurringTransaction
RecurringTransaction 1--* Transaction (onDelete:SetNull, @@unique[recurringTransactionId,scheduledFor])
Transaction TRANSFER = 2 rows sharing transferGroupId (outgoing + incoming legs)
```

---

## Use Case 1 — Register / Login (Auth + Users)

**Modules:** `src/modules/auth/`, `src/modules/users/`

| Step | Action                                                                   |
| ---- | ------------------------------------------------------------------------ |
| 1    | `POST /api/v1/auth/register` `{email, password>=8, firstName, lastName}` |
| 2    | `POST /api/v1/auth/login` `{email, password}` → `{user, accessToken}`    |
| 3    | Send `Authorization: Bearer <accessToken>` on all calls below            |

**Flow (`auth.service.ts`):**

1. `register`: normalize `email.toLowerCase()` → `usersService.findByEmail()` → `409` if taken → `passwordService.hash()` (argon2id via `hash-wasm`, `password.service.ts`) → `usersService.create()` (`defaultCurrency=PHP`) → `jwtService.signAsync({sub:userId})` → safe user (no `passwordHash`).
2. `login`: `findByEmail` → `401 Invalid email or password` if missing / `!isActive` / bad `verify()` → new JWT.
3. `JwtAuthGuard.canActivate()`: extract `Bearer` → `verifyAsync(secret)` → `usersService.findById(sub)` → `request.user={id}`. Rejects deleted/deactivated users per request.

**DTOs:** `dto/register.dto.ts` (`registerSchema`), `dto/login.dto.ts` (`loginSchema`), `dto/auth-response.dto.ts`.

**Sample input — register:**

```json
POST /api/v1/auth/register
{
  "email": "juan.delacruz@example.com",
  "password": "Sup3rSecret!",
  "firstName": "Juan",
  "lastName": "Dela Cruz"
}
```

**Sample response — `201 {success:true, data:{user, accessToken}}`:**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "a8098c1a-f86e-11da-bd1a-00112444be1e",
      "email": "juan.delacruz@example.com",
      "firstName": "Juan",
      "lastName": "Dela Cruz",
      "isActive": true,
      "emailVerifiedAt": null,
      "createdAt": "2026-10-07T00:00:00.000Z",
      "updatedAt": "2026-10-07T00:00:00.000Z"
    },
    "accessToken": "<jwt>"
  }
}
```

**Sample input — login:**

```json
POST /api/v1/auth/login
{
  "email": "juan.delacruz@example.com",
  "password": "Sup3rSecret!"
}
```

---

## Use Case 2 — Manage Accounts (money containers)

**Module:** `src/modules/accounts/` — `accounts.controller.ts`, `accounts.service.ts`

```text
POST   /accounts {name, type:CASH|BANK|E_WALLET|CREDIT_CARD|INVESTMENT|OTHER, currency=PHP, initialBalance=0}
GET    /accounts?page=1&limit=20&type=&search=&sortBy=name|createdAt&sortOrder=asc
GET    /accounts/:id
PATCH  /accounts/:id {name?, type?, currency?}   # initialBalance immutable
DELETE /accounts/:id                             # soft: isArchived=true
GET    /accounts/:id/balance                     # computed, must come before /:id route
GET    /accounts/:id/transactions?page&limit&type&dateFrom&dateTo
```

**Rules:**

- `@@unique[userId,name]` → `409` on duplicate.
- All reads scope `where:{userId, isArchived:false}`.
- `getBalance()`: `initialBalance + incomes - expenses + transferIn - transferOut` using `Prisma.Decimal`, skips counterparty leg. Returns `toFixed(2)` strings.
- `findTransactions()`: only own leg (`accountId`), ordered `transactionDate desc`.

**Sample input — create account:**

```json
POST /api/v1/accounts
Authorization: Bearer <jwt>
{
  "name": "BPI Savings",
  "type": "BANK",
  "currency": "PHP",
  "initialBalance": 10000
}
```

**Sample input — list + balance:**

```text
GET /api/v1/accounts?page=1&limit=20&sortBy=name&sortOrder=asc
GET /api/v1/accounts/<accountId>/balance
```

**Sample response — balance:**

```json
{
  "success": true,
  "data": {
    "accountId": "550e8400-e29b-41d4-a716-446655440000",
    "initialBalance": "10000.00",
    "income": "5000.00",
    "expenses": "2500.00",
    "transferIn": "1000.00",
    "transferOut": "500.00",
    "balance": "13000.00"
  }
}
```

---

## Use Case 3 — Manage Categories (income/expense labels)

**Module:** `src/modules/categories/` — `categories.controller.ts`, `categories.service.ts`

```text
POST   /categories {name, type:INCOME|EXPENSE, color?}
GET    /categories?page&limit&type&search&sortBy&sortOrder
GET    /categories/:id
PATCH  /categories/:id {name?, type?, color?}
DELETE /categories/:id   # soft: isArchived=true
```

**Rules:**

- `@@unique[userId,name,type]` — same name allowed across `INCOME` vs `EXPENSE`.
- Same ownership + soft-delete pattern as Accounts.
- `validateCategory` in Transactions/Recurring rejects archived/foreign categories with `404`.

**Sample inputs — create categories:**

```json
POST /api/v1/categories
Authorization: Bearer <jwt>
{
  "name": "Salary",
  "type": "INCOME"
}
```

```json
POST /api/v1/categories
Authorization: Bearer <jwt>
{
  "name": "Food",
  "type": "EXPENSE",
  "color": "#FF6B6B"
}
```

**Sample input — list:**

```text
GET /api/v1/categories?type=EXPENSE&search=foo&page=1&limit=20
```

---

## Use Case 4 — Record Transactions (core ledger)

**Module:** `src/modules/transactions/` — `transactions.controller.ts`, `transactions.service.ts`

```text
POST   /transactions {type, amount>0<=2dp, transactionDate:ISO, description?, accountId, categoryId?, toAccountId?(TRANSFER only)}
GET    /transactions?page&limit&type&accountId&categoryId&dateFrom&dateTo&search&sortBy=transactionDate|amount|createdAt&sortOrder=desc
GET    /transactions/:id
PATCH  /transactions/:id {amount?, transactionDate?, description?, accountId?, categoryId?}  # TRANSFER -> 400
DELETE /transactions/:id  # soft: deletedAt=now
```

**Flow:**

1. `create()` dispatches `TRANSFER ? createTransfer() : createSingle()`.
2. `createSingle()`: `validateAccount()` + optional `validateCategory()` → `transaction.create()`.
3. `createTransfer()`: require `toAccountId`, `from !== to`, validate both accounts, `categoryId=null` always, `transferGroupId=randomUUID()`, `$transaction[create(outgoing:accountId=from), create(incoming:accountId=to)]` both with `fromAccountId/toAccountId` set.
4. `update()`: blocks `TRANSFER` (`400 cannot be updated`), re-validates changed `accountId/categoryId`.
5. `archive()`: if `transferGroupId`, `updateMany{transferGroupId}` archives both legs.

**Sample input — income:**

```json
POST /api/v1/transactions
Authorization: Bearer <jwt>
{
  "type": "INCOME",
  "amount": 50000,
  "transactionDate": "2026-10-05T08:00:00.000Z",
  "description": "October salary",
  "accountId": "550e8400-e29b-41d4-a716-446655440000",
  "categoryId": "550e8400-e29b-41d4-a716-446655440001"
}
```

**Sample input — expense:**

```json
POST /api/v1/transactions
Authorization: Bearer <jwt>
{
  "type": "EXPENSE",
  "amount": 250.75,
  "transactionDate": "2026-10-06T12:30:00.000Z",
  "description": "Grocery run",
  "accountId": "550e8400-e29b-41d4-a716-446655440000",
  "categoryId": "550e8400-e29b-41d4-a716-446655440002"
}
```

**Sample input — transfer (creates 2 legs, `categoryId` must be omitted):**

```json
POST /api/v1/transactions
Authorization: Bearer <jwt>
{
  "type": "TRANSFER",
  "amount": 1000,
  "transactionDate": "2026-10-06T15:00:00.000Z",
  "description": "Move to savings",
  "accountId": "550e8400-e29b-41d4-a716-446655440000",
  "toAccountId": "550e8400-e29b-41d4-a716-446655440003"
}
```

**Sample inputs — update / list:**

```json
PATCH /api/v1/transactions/<transactionId>
Authorization: Bearer <jwt>
{
  "amount": 275.5,
  "description": "Grocery run (corrected)"
}
```

```text
GET /api/v1/transactions?type=EXPENSE&accountId=550e8400-e29b-41d4-a716-446655440000&dateFrom=2026-10-01T00:00:00.000Z&dateTo=2026-10-31T23:59:59.000Z&page=1&limit=20
```

---

## Use Case 5 — Automate Recurring Transactions (templates + cron)

**Module:** `src/modules/recurring-transactions/`
**Files:** `recurring-transactions.service.ts` (CRUD), `recurring-transaction-generation.service.ts` (executor), `recurring-transaction-scheduler.service.ts` (cron), `advance-next-run-at.util.ts`, `recurring-transaction-scheduler.constants.ts`

```text
POST   /recurring-transactions {type, amount, frequency:DAILY|WEEKLY|MONTHLY|YEARLY, nextRunAt:ISO, accountId(INCOME/EXPENSE), fromAccountId+toAccountId(TRANSFER), categoryId?, description?}
GET    /recurring-transactions?page&limit&type&frequency&accountId&isActive&search&sortBy=nextRunAt|amount|createdAt
GET    /recurring-transactions/:id
PATCH  /recurring-transactions/:id {amount?, ..., frequency?, nextRunAt?, isActive?}  # type immutable, isActive=false pauses
DELETE /recurring-transactions/:id  # hard delete, past Transactions kept via SetNull
```

**Generation flow (default `*/1 * * * *`, catch-up `31`):**

```text
CronJob(RECURRING_GENERATION_CRON)
 -> runDueSchedules(now): findMany{isActive:true, nextRunAt<=now}
 -> per id: generateDueOccurrences(id, now, limit)
    -> loop generateDueOccurrence(scheduleId, now):
       $transaction: re-read + due check
        -> create Transaction(s): transactionDate=occurrence, recurringTransactionId, scheduledFor=occurrence
           (TRANSFER: outgoing carries scheduledFor, incoming null; copies schedule categoryId to both legs)
        -> advanceSchedule: nextRunAt=advanceNextRunAt(occurrence, frequency)
```

- `advanceNextRunAt`: `DAILY+1d`, `WEEKLY+7d`, `MONTHLY+1mo` / `YEARLY+12mo` with month-end clamp (`Jan31→Feb28`).
- Idempotency: `@@unique[recurringTransactionId,scheduledFor]` `P2002` → fetch existing → `{status:already-generated}`.
- Scheduler tallies `{generated, alreadyGenerated, skipped, failed}` with `isRunning` overlap guard.

**Sample input — monthly salary (INCOME):**

```json
POST /api/v1/recurring-transactions
Authorization: Bearer <jwt>
{
  "type": "INCOME",
  "amount": 50000,
  "description": "Monthly salary",
  "accountId": "550e8400-e29b-41d4-a716-446655440000",
  "categoryId": "550e8400-e29b-41d4-a716-446655440001",
  "frequency": "MONTHLY",
  "nextRunAt": "2026-11-05T08:00:00.000Z"
}
```

**Sample input — monthly transfer (uses `fromAccountId` + `toAccountId`):**

```json
POST /api/v1/recurring-transactions
Authorization: Bearer <jwt>
{
  "type": "TRANSFER",
  "amount": 5000,
  "description": "Auto-save",
  "fromAccountId": "550e8400-e29b-41d4-a716-446655440000",
  "toAccountId": "550e8400-e29b-41d4-a716-446655440003",
  "frequency": "MONTHLY",
  "nextRunAt": "2026-11-01T00:00:00.000Z"
}
```

**Sample inputs — pause / list:**

```json
PATCH /api/v1/recurring-transactions/<id>
Authorization: Bearer <jwt>
{
  "isActive": false
}
```

```text
GET /api/v1/recurring-transactions?isActive=true&frequency=MONTHLY&page=1&limit=20
```

---

## Use Case 6 — View Financial Summary (Reports)

**Module:** `src/modules/reports/` — `reports.controller.ts`, `reports.service.ts`

```text
GET /reports/summary?dateFrom&dateTo -> {fromDate, toDate, income, expenses, netCashFlow, spendingByCategory[{categoryId, categoryName, amount}]}
```

**Flow (`getFinancialSummary`):**

1. `findMany{userId, deletedAt:null, transactionDate range, include:{category}}`.
2. In-memory `Decimal` aggregation: `INCOME→income`, `EXPENSE→expenses + spendingByCategory Map`, `TRANSFER` skipped.
3. Uncategorized `EXPENSE` counts in total, no bucket. Categories sorted desc, `toFixed(2)`.

**Sample input:**

```text
GET /api/v1/reports/summary?dateFrom=2026-10-01T00:00:00.000Z&dateTo=2026-10-31T23:59:59.000Z
Authorization: Bearer <jwt>
```

**Sample response:**

```json
{
  "success": true,
  "data": {
    "fromDate": "2026-10-01T00:00:00.000Z",
    "toDate": "2026-10-31T23:59:59.000Z",
    "income": "50000.00",
    "expenses": "12500.50",
    "netCashFlow": "37499.50",
    "spendingByCategory": [
      {
        "categoryId": "550e8400-e29b-41d4-a716-446655440002",
        "categoryName": "Food",
        "amount": "8000.00"
      },
      {
        "categoryId": "550e8400-e29b-41d4-a716-446655440004",
        "categoryName": "Transport",
        "amount": "4500.50"
      }
    ]
  }
}
```

---

## Recommended Happy-Path Order

1. `POST auth/register` → save `accessToken`.
2. `POST accounts` (e.g. `BPI BANK`, `GCash E_WALLET`) → `POST categories` (`Salary INCOME`, `Food EXPENSE`).
3. `POST transactions` (`INCOME`/`EXPENSE`) or `TRANSFER {accountId, toAccountId}`.
4. `POST recurring-transactions {frequency, nextRunAt}` → verify via `GET transactions`.
5. `GET accounts/:id/balance`, `GET reports/summary?dateFrom&dateTo`.

## Common Errors

| Code  | Cause                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------- |
| `400` | Zod `Validation failed` + `errors[]`, `TRANSFER` missing `toAccountId` / `from==to`, updating `TRANSFER` |
| `401` | Missing/expired JWT, `Invalid email or password`, deactivated user                                       |
| `404` | Foreign/archived `accountId`/`categoryId`, deleted transaction, `P2025`                                  |
| `409` | Duplicate email (generic message), duplicate `account name`, `category name+type`, `P2002` race          |
