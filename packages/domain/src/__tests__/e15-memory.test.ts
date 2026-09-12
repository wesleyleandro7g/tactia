/**
 * Etapa 15 — memória da empresa: fatos (pgvector), episódios, playbooks.
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditLogRepository,
  BusinessFactRepository,
  EMBEDDING_DIMENSIONS,
  EpisodeRepository,
  PlaybookRepository,
  MembershipRepository,
  prisma,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import { ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { AuditLogService } from '../services/audit-log-service';
import { BusinessFactService } from '../services/business-fact-service';
import { EpisodeService } from '../services/episode-service';
import { PlaybookService } from '../services/playbook-service';
import {
  DEMO_PLAYBOOK_RECLAMACAO_ATRASO,
  formatEpisodeText,
} from '../index';
import type { TextEmbedder } from '../ports/embedder';

const SLUGS = ['e15-mem-a', 'e15-mem-b'];

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const factsRepo = new BusinessFactRepository(prisma);
const episodesRepo = new EpisodeRepository(prisma);
const playbooksRepo = new PlaybookRepository(prisma);
const auditLogs = new AuditLogService(new AuditLogRepository(prisma));

const unitVector = (index: number) => {
  const values = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  values[index] = 1;
  return values;
};

function keywordEmbedder(): TextEmbedder {
  return {
    async embed(texts: string[]) {
      return texts.map((text) => {
        const values = unitVector(/atras|reclam|promo/i.test(text) ? 0 : 1);
        return values;
      });
    },
  };
}

let tenantA: string;
let tenantB: string;
let ownerA: RequestContext;
let viewerA: RequestContext;
let ownerB: RequestContext;
let sellerId: string;

function ctx(
  tenantId: string,
  userId: string,
  role: RequestContext['role'] = 'owner',
): RequestContext {
  return { requestId: createId(), tenantId, userId, role, ip: '127.0.0.1' };
}

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: SLUGS } } });
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  await prisma.episode.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.playbook.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.businessFact.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.seller.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  const authUsers = await prisma.authUser.findMany({
    where: { email: { endsWith: '@e15-mem.test' } },
  });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function createUser(name: string) {
  const auth = await prisma.authUser.create({
    data: { id: createId(), name, email: `${name}@e15-mem.test`, emailVerified: true },
  });
  return users.create({ externalAuthId: auth.id, name, email: `${name}@e15-mem.test` });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanUp();

  const tenant = await tenants.create({ name: 'e15-a', slug: 'e15-mem-a' });
  const other = await tenants.create({ name: 'e15-b', slug: 'e15-mem-b' });
  tenantA = tenant.id;
  tenantB = other.id;

  const owner = await createUser('e15-owner-a');
  const viewer = await createUser('e15-viewer-a');
  const ownerOther = await createUser('e15-owner-b');
  await memberships.create({ tenantId: tenantA, userId: owner.id, role: 'owner' });
  await memberships.create({ tenantId: tenantA, userId: viewer.id, role: 'viewer' });
  await memberships.create({ tenantId: tenantB, userId: ownerOther.id, role: 'owner' });

  ownerA = ctx(tenantA, owner.id, 'owner');
  viewerA = ctx(tenantA, viewer.id, 'viewer');
  ownerB = ctx(tenantB, ownerOther.id, 'owner');

  const seller = await prisma.seller.create({
    data: { id: createId(), tenantId: tenantA, name: 'Ana' },
  });
  sellerId = seller.id;
});

beforeEach(async () => {
  await prisma.episode.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.playbook.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.businessFact.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe('E15 facts', () => {
  it('E15: fact embedding written on create when embedder present', async () => {
    const service = new BusinessFactService(factsRepo, keywordEmbedder());
    const fact = await service.create(ownerA, {
      kind: 'event',
      text: 'Cliente reclamou de atraso na entrega',
    });
    expect(fact.indexed).toBe(true);
    const pending = await factsRepo.findPendingEmbedding({ tenantId: tenantA, take: 8 });
    expect(pending.some((row) => row.id === fact.id)).toBe(false);
  });

  it('E15: fact create succeeds when embedder throws', async () => {
    const service = new BusinessFactService(factsRepo, {
      async embed() {
        throw new Error('embedder down');
      },
    });
    const fact = await service.create(ownerA, { kind: 'fact', text: 'Temos promoção de inverno' });
    expect(fact.id).toBeTruthy();
    expect(fact.indexed).toBe(false);
    expect(fact.embeddedAt).toBeNull();
  });

  it('E15: searchByEmbedding never leaks neighbor tenant', async () => {
    const a = await factsRepo.create({
      tenantId: tenantA,
      kind: 'event',
      text: 'reclamação de atraso',
    });
    const b = await factsRepo.create({
      tenantId: tenantB,
      kind: 'event',
      text: 'reclamação de atraso no outro tenant',
    });
    await factsRepo.updateEmbedding({ tenantId: tenantA, id: a.id, embedding: unitVector(0) });
    await factsRepo.updateEmbedding({ tenantId: tenantB, id: b.id, embedding: unitVector(0) });

    const hits = await factsRepo.searchByEmbedding({
      tenantId: tenantA,
      embedding: unitVector(0),
      now: new Date(),
      limit: 10,
    });
    expect(hits.every((hit) => hit.tenantId === tenantA)).toBe(true);
    expect(hits.some((hit) => hit.id === b.id)).toBe(false);
  });

  it('E15: search_business_facts keyword fallback without embedder', async () => {
    const service = new BusinessFactService(factsRepo);
    await service.create(ownerA, { kind: 'fact', text: 'Temos promoção de inverno no sul' });
    const result = await service.searchSemantic(ownerA, { query: 'promoção' });
    expect(result.mode).toBe('keyword');
    expect(result.items.some((item) => /promoção/i.test(item.text))).toBe(true);
  });

  it('E15: facts settings persists entityType entityId validTo', async () => {
    const service = new BusinessFactService(factsRepo);
    const validTo = new Date('2026-12-31T23:59:59.000Z');
    const fact = await service.create(ownerA, {
      kind: 'event',
      text: 'Ana saiu de licença',
      entityType: 'seller',
      entityId: sellerId,
      validTo,
    });
    expect(fact.entityType).toBe('seller');
    expect(fact.entityId).toBe(sellerId);
    expect(fact.validTo?.toISOString()).toBe(validTo.toISOString());
    const { items } = await service.listActive(ownerA);
    expect(items[0]?.entityType).toBe('seller');
    expect(items[0]?.entityId).toBe(sellerId);
  });
});

describe('E15 episodes', () => {
  it('E15: search_episodes isolated by tenant', async () => {
    const service = new EpisodeService(episodesRepo);
    await service.record({
      tenantId: tenantA,
      kind: 'decision',
      outcome: 'approved',
      text: 'Proposta create_task (user): approved.\nMotivo da proposta: desconto.',
      occurredAt: new Date(),
    });
    await service.record({
      tenantId: tenantB,
      kind: 'decision',
      outcome: 'approved',
      text: 'Proposta create_task (user): approved.\nMotivo da proposta: desconto vizinho.',
      occurredAt: new Date(),
    });

    const result = await service.searchSemantic(ownerA, { query: 'desconto' });
    expect(result.items.every((item) => item.tenantId === tenantA)).toBe(true);
    expect(result.items.some((item) => /vizinho/.test(item.text))).toBe(false);
  });

  it('E15: episode searchByEmbedding never leaks neighbor tenant', async () => {
    const a = await episodesRepo.create({
      tenantId: tenantA,
      kind: 'decision',
      outcome: 'approved',
      text: 'desconto aprovado',
      occurredAt: new Date(),
    });
    const b = await episodesRepo.create({
      tenantId: tenantB,
      kind: 'decision',
      outcome: 'approved',
      text: 'desconto aprovado vizinho',
      occurredAt: new Date(),
    });
    await episodesRepo.updateEmbedding({ tenantId: tenantA, id: a.id, embedding: unitVector(0) });
    await episodesRepo.updateEmbedding({ tenantId: tenantB, id: b.id, embedding: unitVector(0) });
    const hits = await episodesRepo.searchByEmbedding({
      tenantId: tenantA,
      embedding: unitVector(0),
      limit: 10,
    });
    expect(hits.every((hit) => hit.tenantId === tenantA)).toBe(true);
    expect(hits.some((hit) => hit.id === b.id)).toBe(false);
  });
});

describe('E15 playbooks', () => {
  it('E15: create playbook member ok, viewer 403', async () => {
    const service = new PlaybookService(playbooksRepo, auditLogs);
    const created = await service.create(ownerA, {
      slug: 'reclamacao-atraso',
      title: 'Reclamação de atraso',
      trigger: 'cliente reclama de atraso',
      steps: [{ ordinal: 1, text: 'Confirmar o pedido' }],
    });
    expect(created.slug).toBe('reclamacao-atraso');

    await expect(
      service.create(viewerA, {
        slug: 'outro-playbook',
        title: 'Outro',
        trigger: 'quando fizer sentido',
        steps: [{ ordinal: 1, text: 'Passo' }],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORIZATION_ERROR, statusCode: 403 });
  });

  it('E15: unique slug per tenant', async () => {
    const service = new PlaybookService(playbooksRepo, auditLogs);
    const payload = {
      slug: 'unico-slug',
      title: 'Um',
      trigger: 'quando',
      steps: [{ ordinal: 1, text: 'Passo' }],
    };
    await service.create(ownerA, payload);
    await expect(service.create(ownerA, payload)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
    const other = await service.create(ownerB, payload);
    expect(other.slug).toBe('unico-slug');
  });

  it('E15: playbook searchByEmbedding never leaks neighbor tenant', async () => {
    const a = await playbooksRepo.create({
      tenantId: tenantA,
      slug: 'local',
      title: 'Reclamação',
      trigger: 'atraso',
      steps: [{ ordinal: 1, text: 'Confirmar' }],
    });
    const b = await playbooksRepo.create({
      tenantId: tenantB,
      slug: 'local',
      title: 'Reclamação',
      trigger: 'atraso',
      steps: [{ ordinal: 1, text: 'Confirmar' }],
    });
    await playbooksRepo.updateEmbedding({ tenantId: tenantA, id: a.id, embedding: unitVector(0) });
    await playbooksRepo.updateEmbedding({ tenantId: tenantB, id: b.id, embedding: unitVector(0) });
    const hits = await playbooksRepo.searchByEmbedding({
      tenantId: tenantA,
      embedding: unitVector(0),
      limit: 10,
    });
    expect(hits.every((hit) => hit.tenantId === tenantA)).toBe(true);
    expect(hits.some((hit) => hit.id === b.id)).toBe(false);
  });

  it('E15: seed includes reclamacao-atraso', () => {
    expect(DEMO_PLAYBOOK_RECLAMACAO_ATRASO.slug).toBe('reclamacao-atraso');
    const seedPath = fileURLToPath(new URL('../../../../apps/web/scripts/seed.ts', import.meta.url));
    const src = readFileSync(seedPath, 'utf8');
    expect(src).toContain('DEMO_PLAYBOOK_RECLAMACAO_ATRASO');
    expect(src).toContain('seedPlaybooks');
  });
});

describe('formatEpisodeText', () => {
  it('builds deterministic pt-BR text without email body', () => {
    const text = formatEpisodeText({
      actionType: 'send_email',
      origin: 'ai',
      outcome: 'approved',
      reason: 'Cliente 123.456.789-09 pediu retorno',
      input: { to: 'a@ex.com', subject: 'Desculpas', body: 'corpo secreto' },
    });
    expect(text).toContain('Proposta send_email (ai): approved.');
    expect(text).toContain('Motivo da proposta: Cliente [cpf] pediu retorno.');
    expect(text).toContain('Destinatário: a@ex.com; assunto: Desculpas');
    expect(text).not.toContain('corpo secreto');
    expect(text).not.toContain('123.456.789-09');
  });
});
