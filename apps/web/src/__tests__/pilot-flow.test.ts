/**
 * E2E do fluxo da spec §2 — "criar empresa → … → registrar a execução".
 *
 * Roda no ponto de composição (apps/web): as mesmas classes que `lib/services.ts`
 * liga em produção, com Postgres real e um `LLMAdapter` determinístico. O único
 * substituto é o `AuthProvider` (Better Auth), porque o teste não sobe HTTP.
 */
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ActionExecutionRepository,
  ActionRepository,
  ActivityRepository,
  ApprovalRepository,
  AuditLogRepository,
  CampaignRepository,
  ConversationRepository,
  CredentialRepository,
  CustomerRepository,
  DataQualityReportRepository,
  DataSourceRepository,
  ExpenseRepository,
  ImportRepository,
  InsightRepository,
  InteractionRepository,
  InventoryLevelRepository,
  LeadRepository,
  MappingRepository,
  MembershipRepository,
  MessageRepository,
  MetricRepository,
  prisma,
  PaymentRepository,
  ProductRepository,
  RawRecordRepository,
  RecommendationRepository,
  SaleRepository,
  SellerRepository,
  SyncJobRepository,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import {
  ActivityService,
  AuditLogService,
  AnalyticsService,
  ConversationService,
  CustomerService,
  DataSourceService,
  IntelligencePipelineService,
  InsightService,
  InteractionService,
  LeadService,
  MetricService,
  ProductService,
  RecommendationService,
  SaleService,
  SellerService,
  SyncService,
  TenantService,
  UserService,
} from '@tactia/domain';
import { MetricEngine } from '@tactia/intelligence';
import {
  ActionService,
  ApprovalService,
  createDefaultActionRegistry,
  ExecutionEngine,
  MemoryEmailSender,
} from '@tactia/execution';
import {
  ContextBuilder,
  createDefaultTools,
  MockLLMAdapter,
  Orchestrator,
  ToolRegistry,
  type ActionProposalPort,
  type ToolContext,
} from '@tactia/ai';
import { createId, type RequestContext } from '@tactia/shared';

// ---------------------------------------------------------------------------
// Wiring (mirrors apps/web/src/lib/services.ts)
// ---------------------------------------------------------------------------

const auditLogRepository = new AuditLogRepository(prisma);
const auditLogService = new AuditLogService(auditLogRepository);
const tenantRepository = new TenantRepository(prisma);
const membershipRepository = new MembershipRepository(prisma);
const userRepository = new UserRepository(prisma);
const customerRepository = new CustomerRepository(prisma);
const leadRepository = new LeadRepository(prisma);
const productRepository = new ProductRepository(prisma);
const sellerRepository = new SellerRepository(prisma);
const saleRepository = new SaleRepository(prisma);
const activityRepository = new ActivityRepository(prisma);
const interactionRepository = new InteractionRepository(prisma);
const expenseRepository = new ExpenseRepository(prisma);
const paymentRepository = new PaymentRepository(prisma);
const inventoryLevelRepository = new InventoryLevelRepository(prisma);
const campaignRepository = new CampaignRepository(prisma);
const dataSourceRepository = new DataSourceRepository(prisma);
const credentialRepository = new CredentialRepository(prisma);
const syncJobRepository = new SyncJobRepository(prisma);
const rawRecordRepository = new RawRecordRepository(prisma);
const mappingRepository = new MappingRepository(prisma);
const importRepository = new ImportRepository(prisma);
const dataQualityReportRepository = new DataQualityReportRepository(prisma);
const metricRepository = new MetricRepository(prisma);
const insightRepository = new InsightRepository(prisma);
const recommendationRepository = new RecommendationRepository(prisma);
const conversationRepository = new ConversationRepository(prisma);
const messageRepository = new MessageRepository(prisma);
const actionRepository = new ActionRepository(prisma);
const actionExecutionRepository = new ActionExecutionRepository(prisma);
const approvalRepository = new ApprovalRepository(prisma);

/** Better Auth stands in for the identity provider; the port is tiny. */
const authProvider = {
  async createCredentialsUser(input: { email: string; name: string; password: string }) {
    const id = createId();
    await prisma.authUser.create({
      data: { id, name: input.name, email: input.email, emailVerified: true },
    });
    await prisma.authAccount.create({
      data: {
        id: createId(),
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: 'hashed',
      },
    });
    return { externalAuthId: id };
  },
};

const tenantService = new TenantService(tenantRepository, membershipRepository, auditLogService);
const userService = new UserService(
  userRepository,
  membershipRepository,
  auditLogService,
  authProvider,
);
const customerService = new CustomerService(customerRepository, auditLogService);
const productService = new ProductService(productRepository, auditLogService);
const sellerService = new SellerService(sellerRepository, auditLogService);
const saleService = new SaleService(
  saleRepository,
  customerRepository,
  productRepository,
  sellerRepository,
  auditLogService,
);
const activityService = new ActivityService(
  activityRepository,
  customerRepository,
  leadRepository,
  sellerRepository,
  auditLogService,
);
const interactionService = new InteractionService(
  interactionRepository,
  customerRepository,
  auditLogService,
);
const leadService = new LeadService(leadRepository, customerRepository, auditLogService, prisma);
void leadService;
void activityService;

const dataSourceService = new DataSourceService(
  dataSourceRepository,
  mappingRepository,
  credentialRepository,
  auditLogService,
);
const metricService = new MetricService(new MetricEngine(prisma), metricRepository);
const analyticsService = new AnalyticsService(prisma);
const insightService = new InsightService(insightRepository);
const recommendationService = new RecommendationService(recommendationRepository, auditLogService);
const intelligencePipelineService = new IntelligencePipelineService(
  prisma,
  insightRepository,
  recommendationRepository,
  auditLogService,
);

const pipelineRuns: string[] = [];
const syncService = new SyncService({
  dataSources: dataSourceRepository,
  syncJobs: syncJobRepository,
  rawRecords: rawRecordRepository,
  imports: importRepository,
  qualityReports: dataQualityReportRepository,
  mappings: mappingRepository,
  credentials: credentialRepository,
  auditLogs: auditLogService,
  customers: customerRepository,
  products: productRepository,
  sellers: sellerRepository,
  sales: saleRepository,
  interactions: interactionRepository,
  leads: leadRepository,
  activities: activityRepository,
  expenses: expenseRepository,
  payments: paymentRepository,
  inventoryLevels: inventoryLevelRepository,
  campaigns: campaignRepository,
  onSyncCompleted: async ({ tenantId, syncJobId, userId }) => {
    pipelineRuns.push(syncJobId);
    await intelligencePipelineService.run({ tenantId, actorCtx: { tenantId, userId } });
  },
});

const conversationService = new ConversationService(
  conversationRepository,
  messageRepository,
  auditLogService,
);

const emailSender = new MemoryEmailSender();
const actionRegistry = createDefaultActionRegistry({
  activities: activityRepository,
  customers: customerRepository,
  leads: leadRepository,
  sellers: sellerRepository,
  emailSender,
});
const executionEngine = new ExecutionEngine({
  actions: actionRepository,
  executions: actionExecutionRepository,
  approvals: approvalRepository,
  registry: actionRegistry,
  auditLogs: auditLogService,
});
const actionService = new ActionService(
  actionRepository,
  actionExecutionRepository,
  actionRegistry,
  auditLogService,
);
const approvalService = new ApprovalService(approvalRepository, executionEngine);

const actionProposer: ActionProposalPort = {
  propose: (ctx, input) => executionEngine.proposeFromAi(ctx, input),
};
const toolRegistry = new ToolRegistry(
  createDefaultTools(
    {
      metrics: metricService,
      analytics: analyticsService,
      customers: customerService,
      products: productService,
      sellers: sellerService,
      sales: saleService,
      insights: insightService,
      recommendations: recommendationService,
      interactions: interactionService,
    },
    { actionProposer },
  ),
);
const contextBuilder = new ContextBuilder({
  tenants: tenantService,
  metrics: metricService,
  insights: insightService,
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);

/** Revenue collapses from 4.000 to 200 → triggers the `revenue_drop` rule. */
const PREVIOUS_WINDOW_REVENUE = 4000;
const CURRENT_WINDOW_REVENUE = 200;

let dir: string;
let ownerAuthId: string;
let ownerUserId: string;
let memberUserId: string | null = null;
let tenantId: string;
let ownerCtx: RequestContext;
let otherTenantId: string;
let otherUserId: string;
let otherAuthId: string;
const sourceIds: Record<string, string> = {};

const ownerEmail = `pilot-owner-${createId()}@pilot.local`;
const memberEmail = `pilot-member-${createId()}@pilot.local`;

async function writeCsv(name: string, content: string) {
  const filePath = path.join(dir, name);
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

/** Creates a CSV DataSource the same way the onboarding wizard does. */
async function configureCsvSource(input: {
  name: string;
  filePath: string;
  targetEntity: string;
  fields: string[];
}) {
  const ds = await dataSourceService.create(ownerCtx, {
    name: input.name,
    type: 'csv',
    configuration: { filePath: input.filePath },
  });

  const test = await dataSourceService.testConnection(ownerCtx, ds.id);
  expect(test.success).toBe(true);

  const discovery = await dataSourceService.discover(ownerCtx, ds.id);
  const columns = discovery.resources[0]!.columns.map((column) => column.name);
  for (const field of input.fields) expect(columns).toContain(field);

  await dataSourceService.createMapping(ownerCtx, ds.id, {
    sourceEntity: 'data',
    targetEntity: input.targetEntity,
    configuration: { fields: input.fields.map((field) => ({ source: field, target: field })) },
  });

  sourceIds[input.targetEntity] = ds.id;
  return ds.id;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tactia-e2e-'));

  // The owner signs up through the auth provider, exactly like /signup.
  const created = await authProvider.createCredentialsUser({
    email: ownerEmail,
    name: 'Operador Piloto',
    password: 'password123',
  });
  ownerAuthId = created.externalAuthId;
  const ownerUser = await userService.ensureFromExternalAuth({
    externalAuthId: ownerAuthId,
    name: 'Operador Piloto',
    email: ownerEmail,
  });
  ownerUserId = ownerUser.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.user.deleteMany({
    where: { email: { in: [ownerEmail, memberEmail, `other-${otherAuthId}@pilot.local`] } },
  });
  await prisma.authAccount.deleteMany({
    where: { userId: { in: [ownerAuthId, otherAuthId].filter(Boolean) } },
  });
  await prisma.authUser.deleteMany({
    where: { email: { in: [ownerEmail, memberEmail, `other-${otherAuthId}@pilot.local`] } },
  });
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe('Fluxo do piloto (spec §2)', () => {
  it('1. cria a empresa', async () => {
    const ctx: RequestContext = {
      requestId: createId(),
      tenantId: null,
      userId: ownerUserId,
      role: null,
    };
    const tenant = await tenantService.create(ctx, { name: `Piloto ${createId().slice(0, 8)}` });
    tenantId = tenant.id;
    ownerCtx = { requestId: createId(), tenantId, userId: ownerUserId, role: 'owner' };

    const audit = await auditLogService.list({ tenantId, skip: 0, take: 20 });
    expect(audit.items.map((log) => log.action)).toContain('TENANT_CREATED');
  });

  it('2. cria usuários', async () => {
    const result = await userService.create(ownerCtx, {
      name: 'Analista',
      email: memberEmail,
      password: 'password123',
      role: 'member',
    });
    memberUserId = result.user.id;

    const users = await userService.list(ownerCtx, {});
    expect(users.total).toBe(2);

    const audit = await auditLogService.list({ tenantId, skip: 0, take: 20 });
    expect(audit.items.map((log) => log.action)).toContain('USER_CREATED');
  });

  it('3. configura as fontes de dados (testar → descobrir → mapear → prévia)', async () => {
    const customersCsv = await writeCsv(
      'clientes.csv',
      [
        'external_id,name,email',
        'C1,Padaria Aurora,aurora@example.com',
        'C2,Mercado Central,central@example.com',
        'C3,Farmácia Vida,vida@example.com',
      ].join('\n'),
    );
    const productsCsv = await writeCsv(
      'produtos.csv',
      ['external_id,name,price', 'P1,Plano Anual,1000', 'P2,Plano Mensal,200'].join('\n'),
    );
    const sellersCsv = await writeCsv(
      'vendedores.csv',
      ['external_id,name,email', 'V1,Ana,ana@example.com', 'V2,Bruno,bruno@example.com'].join('\n'),
    );
    // 4 vendas de 1.000 no período anterior, 1 de 200 no período atual.
    const salesCsv = await writeCsv(
      'vendas.csv',
      [
        'external_id,customer_external_id,seller_external_id,product_external_id,quantity,unit_price,total_amount,sold_at,status',
        `S1,C1,V1,P1,1,1000,1000,${iso(45)},confirmed`,
        `S2,C2,V1,P1,1,1000,1000,${iso(42)},confirmed`,
        `S3,C3,V2,P1,1,1000,1000,${iso(38)},confirmed`,
        `S4,C1,V2,P1,1,1000,1000,${iso(34)},confirmed`,
        `S5,C2,V1,P2,1,200,200,${iso(5)},confirmed`,
        `S6,C3,V1,P2,1,999,999,${iso(3)},cancelled`,
      ].join('\n'),
    );

    await configureCsvSource({
      name: 'Clientes CSV',
      filePath: customersCsv,
      targetEntity: 'customer',
      fields: ['external_id', 'name', 'email'],
    });
    await configureCsvSource({
      name: 'Produtos CSV',
      filePath: productsCsv,
      targetEntity: 'product',
      fields: ['external_id', 'name', 'price'],
    });
    await configureCsvSource({
      name: 'Vendedores CSV',
      filePath: sellersCsv,
      targetEntity: 'seller',
      fields: ['external_id', 'name', 'email'],
    });
    await configureCsvSource({
      name: 'Vendas CSV',
      filePath: salesCsv,
      targetEntity: 'sale',
      fields: [
        'external_id',
        'customer_external_id',
        'seller_external_id',
        'product_external_id',
        'quantity',
        'unit_price',
        'total_amount',
        'sold_at',
        'status',
      ],
    });

    const preview = await dataSourceService.preview(ownerCtx, sourceIds['sale']!, 'data', 3);
    expect(preview).toHaveLength(3);

    const audit = await auditLogService.list({ tenantId, skip: 0, take: 50 });
    expect(audit.items.map((log) => log.action)).toContain('DATA_SOURCE_CREATED');
  });

  it('4. importa os dados', async () => {
    for (const entity of ['customer', 'product', 'seller', 'sale']) {
      const job = await syncService.startSync(ownerCtx, sourceIds[entity]!);
      expect(job?.status).toBe('completed');
    }

    const jobs = await syncService.listSyncJobs(ownerCtx, { pageSize: '50' });
    expect(jobs.items).toHaveLength(4);
    expect(jobs.items.every((job) => job.status === 'completed')).toBe(true);

    const audit = await auditLogService.list({ tenantId, skip: 0, take: 100 });
    const actions = audit.items.map((log) => log.action);
    expect(actions).toContain('SYNC_STARTED');
    expect(actions).toContain('SYNC_COMPLETED');
  });

  it('5. normaliza os dados (raw preservado + canônico)', async () => {
    const raw = await rawRecordRepository.list({
      tenantId,
      dataSourceId: sourceIds['sale']!,
      skip: 0,
      take: 100,
    });
    expect(raw.total).toBe(6);
    expect(raw.items[0]!.payload).toBeTruthy();

    const [customers, products, sellers, sales] = await Promise.all([
      customerRepository.list({ tenantId, skip: 0, take: 100 }),
      productRepository.list({ tenantId, skip: 0, take: 100 }),
      sellerRepository.list({ tenantId, skip: 0, take: 100 }),
      saleRepository.list({ tenantId, skip: 0, take: 100 }),
    ]);
    expect(customers.total).toBe(3);
    expect(products.total).toBe(2);
    expect(sellers.total).toBe(2);
    expect(sales.total).toBe(6);
    expect(sales.items.every((sale) => sale.items.length === 1)).toBe(true);

    const quality = await dataQualityReportRepository.list({
      tenantId,
      dataSourceId: sourceIds['sale']!,
      skip: 0,
      take: 10,
    });
    expect(quality.items.length).toBeGreaterThan(0);
  });

  it('6. consulta informações empresariais pela API de domínio', async () => {
    const customers = await customerService.list(ownerCtx, { search: 'Aurora' });
    expect(customers.items[0]!.name).toBe('Padaria Aurora');

    const sales = await saleService.list(ownerCtx, { pageSize: '50' });
    expect(sales.total).toBe(6);
  });

  it('7. calcula métricas (canceladas fora da receita)', async () => {
    const revenue = await metricService.calculate(ownerCtx, 'revenue', {
      period: { from: iso(30), to: new Date().toISOString() },
      withComparison: true,
    });

    expect(revenue.value).toBe(CURRENT_WINDOW_REVENUE);
    expect(revenue.comparison?.value).toBe(PREVIOUS_WINDOW_REVENUE);
    expect(revenue.comparison?.direction).toBe('down');

    const bulk = await metricService.calculateBulk(ownerCtx, {
      from: iso(30),
      to: new Date().toISOString(),
    });
    expect(bulk.metrics.length).toBeGreaterThanOrEqual(7);
    expect(bulk.metrics.some((metric) => metric.key === 'revenue')).toBe(true);
  });

  it('8. gera insights automaticamente depois do sync', async () => {
    expect(pipelineRuns.length).toBe(4);

    const insights = await insightService.list(ownerCtx, { pageSize: '50' });
    const drop = insights.items.find((insight) => insight.ruleKey === 'revenue_drop');
    expect(drop).toBeDefined();
    expect(drop!.type).toBe('anomaly');
    expect(['high', 'critical']).toContain(drop!.severity);

    // Evidence traceable back to the metric (spec §43)
    const evidence = drop!.evidence as Array<{ key: string; value: number }>;
    expect(evidence.some((item) => item.key === 'revenue_growth')).toBe(true);

    const audit = await auditLogService.list({ tenantId, skip: 0, take: 200 });
    expect(audit.items.map((log) => log.action)).toContain('INSIGHT_CREATED');
  });

  it('9. apresenta o insight e a recomendação ao usuário', async () => {
    const insights = await insightService.list(ownerCtx, { pageSize: '50' });
    const drop = insights.items.find((insight) => insight.ruleKey === 'revenue_drop')!;
    const detail = await insightService.getById(ownerCtx, drop.id);
    expect(detail.recommendations.length).toBeGreaterThan(0);

    const recommendations = await recommendationService.list(ownerCtx, { status: 'pending' });
    expect(recommendations.total).toBeGreaterThan(0);
  });

  it('10. o chat responde com dados reais e evidência', async () => {
    const llm = new MockLLMAdapter({
      script: [
        { toolCalls: [{ name: 'get_revenue', input: { compareWithPreviousPeriod: true } }] },
        { text: 'A receita dos últimos 30 dias foi de R$ 200,00.' },
      ],
    });
    const orchestrator = new Orchestrator({ llm, tools: toolRegistry, contextBuilder });
    const toolCtx: ToolContext = {
      requestId: createId(),
      tenantId,
      userId: ownerUserId,
      role: 'owner',
    };

    const conversation = await conversationService.create(ownerCtx, {});
    const answer = await orchestrator.run({
      ctx: toolCtx,
      question: 'Quanto vendemos este mês?',
      period: { from: new Date(Date.now() - 30 * DAY), to: new Date() },
    });

    expect(answer.toolCalls.map((call) => call.name)).toContain('get_revenue');
    expect(answer.sources.some((source) => source.metric === 'revenue')).toBe(true);
    expect(answer.guardrail).toBeUndefined();

    const message = await conversationService.appendMessage(ownerCtx, conversation.id, {
      role: 'assistant',
      content: answer.content,
      metadata: { sources: answer.sources },
    });
    const stored = await conversationService.listMessages(ownerCtx, conversation.id);
    expect(stored.find((item) => item.id === message.id)!.metadata).toBeTruthy();
  });

  it('11. solicita uma ação: a IA propõe e nada executa sem aprovação', async () => {
    const llm = new MockLLMAdapter({
      script: [
        {
          toolCalls: [
            {
              name: 'propose_action',
              input: {
                actionType: 'create_task',
                input: { title: 'Ligar para a Padaria Aurora' },
                reason: 'Queda de receita',
              },
            },
          ],
        },
        { text: 'Criei a proposta; ela está pendente de aprovação.' },
      ],
    });
    const orchestrator = new Orchestrator({ llm, tools: toolRegistry, contextBuilder });
    const answer = await orchestrator.run({
      ctx: { requestId: createId(), tenantId, userId: ownerUserId, role: 'owner' },
      question: 'Crie uma tarefa para ligar para a Padaria Aurora',
    });

    expect(answer.proposals).toHaveLength(1);
    expect(answer.proposals[0]!.status).toBe('awaiting_approval');

    const queue = await approvalService.list(ownerCtx, { status: 'pending' });
    expect(queue.total).toBe(1);

    const tasks = await activityRepository.list({ tenantId, skip: 0, take: 50, type: 'task' });
    expect(tasks.total).toBe(0); // nothing executed yet
  });

  it('12. registra a execução depois da aprovação', async () => {
    const queue = await approvalService.list(ownerCtx, { status: 'pending' });
    const approval = queue.items[0]!;

    const execution = await approvalService.approve(ownerCtx, approval.id, {
      reason: 'Confirmado',
    });
    expect(execution.status).toBe('completed');
    expect((execution.output as { activityId?: string }).activityId).toBeTruthy();
    expect(execution.startedAt).toBeTruthy();
    expect(execution.finishedAt).toBeTruthy();

    const tasks = await activityRepository.list({ tenantId, skip: 0, take: 50, type: 'task' });
    expect(tasks.total).toBe(1);
    expect((tasks.items[0]!.metadata as { title?: string }).title).toBe(
      'Ligar para a Padaria Aurora',
    );

    const executions = await actionService.listExecutions(ownerCtx, { pageSize: '50' });
    expect(executions.items.some((item) => item.status === 'completed')).toBe(true);

    const audit = await auditLogService.list({ tenantId, skip: 0, take: 300 });
    const actions = audit.items.map((log) => log.action);
    expect(actions).toContain('ACTION_PROPOSED');
    expect(actions).toContain('ACTION_APPROVED');
    expect(actions).toContain('ACTION_EXECUTED');
  });

  it('13. o tenant vizinho não vê nada do piloto', async () => {
    otherAuthId = createId();
    const otherEmail = `other-${otherAuthId}@pilot.local`;
    await prisma.authUser.create({
      data: { id: otherAuthId, name: 'Outro', email: otherEmail, emailVerified: true },
    });
    const otherUser = await userService.ensureFromExternalAuth({
      externalAuthId: otherAuthId,
      name: 'Outro',
      email: otherEmail,
    });
    otherUserId = otherUser.id;
    const bootstrapCtx: RequestContext = {
      requestId: createId(),
      tenantId: null,
      userId: otherUserId,
      role: null,
    };
    const otherTenant = await tenantService.create(bootstrapCtx, {
      name: `Vizinho ${createId().slice(0, 8)}`,
    });
    otherTenantId = otherTenant.id;
    const otherCtx: RequestContext = {
      requestId: createId(),
      tenantId: otherTenantId,
      userId: otherUserId,
      role: 'owner',
    };

    const sales = await saleService.list(otherCtx, { pageSize: '50' });
    expect(sales.total).toBe(0);

    const insights = await insightService.list(otherCtx, { pageSize: '50' });
    expect(insights.total).toBe(0);

    const approvals = await approvalService.list(otherCtx, { status: 'pending' });
    expect(approvals.total).toBe(0);

    const revenue = await metricService.calculate(otherCtx, 'revenue', {
      period: { from: iso(60), to: new Date().toISOString() },
    });
    expect(revenue.value).toBe(0);

    await expect(
      dataSourceService.get(otherCtx, sourceIds['sale']!),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(memberUserId).toBeTruthy();
  });

  it('14. as tools de metas, funil e lucro operacional estão registradas', () => {
    expect(toolRegistry.has('get_goals_progress')).toBe(true);
    expect(toolRegistry.has('get_funnel')).toBe(true);
    expect(toolRegistry.has('get_profitability')).toBe(true);
    expect(toolRegistry.has('get_cash_flow')).toBe(true);
    expect(toolRegistry.has('get_inventory_risk')).toBe(true);
    expect(toolRegistry.has('get_acquisition')).toBe(true);
    expect(toolRegistry.has('remember_fact')).toBe(true);
    expect(toolRegistry.has('simulate')).toBe(true);
  });
});
