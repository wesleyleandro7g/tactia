import { Prisma, type PrismaClient } from '@tactia/database';
import { AppError, ErrorCode, createId, type RequestContext } from '@tactia/shared';
import {
  acquisitionLeadSchema,
  consultationLeadSchema,
  acquisitionStatusSchema,
  editableAcquisitionStatusSchema,
} from '@tactia/shared/acquisition';
import { z } from 'zod';
import { assertOperator } from '../authz';
import { provisionTenantSchema } from '../schemas/identity';
import { AuditAction } from './audit-log-service';

const listSchema = z.object({
  q: z.string().trim().max(120).default(''),
  status: z.union([acquisitionStatusSchema, z.literal('')]).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

export class AcquisitionLeadService {
  constructor(private readonly db: PrismaClient) {}

  async capture(raw: unknown) {
    const { website, ...input } = acquisitionLeadSchema.parse(raw);
    if (website) return { received: true };
    // No public read/update, even when the submission ID has already been used.
    await this.db.acquisitionLead.createMany({
      data: [
        {
          ...input,
          id: createId(),
          segmentOther: input.segment === 'Outros' ? input.segmentOther : null,
        },
      ],
      skipDuplicates: true,
    });
    return { received: true };
  }

  async captureConsultation(raw: unknown) {
    const { website, attribution, ...input } = consultationLeadSchema.parse(raw);
    if (website) return { received: true };
    await this.db.acquisitionLead.createMany({
      data: [
        {
          ...input,
          id: createId(),
          source: 'landing',
          systems: [],
          ...(attribution ? { attribution } : {}),
        },
      ],
      skipDuplicates: true,
    });
    return { received: true };
  }

  async list(ctx: RequestContext, raw: unknown) {
    assertOperator(ctx);
    const query = listSchema.parse(raw);
    const where: Prisma.AcquisitionLeadWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: ['name', 'email', 'company'].map((field) => ({
              [field]: { contains: query.q, mode: 'insensitive' },
            })),
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.acquisitionLead.findMany({
        where,
        skip: (query.page - 1) * 20,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.db.acquisitionLead.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: 20 };
  }

  async get(ctx: RequestContext, id: string) {
    assertOperator(ctx);
    z.string().uuid().parse(id);
    const lead = await this.db.acquisitionLead.findUnique({ where: { id } });
    if (!lead) throw new AppError(ErrorCode.NOT_FOUND, 'Lead não encontrado.');
    return lead;
  }

  async updateStatus(ctx: RequestContext, id: string, raw: unknown) {
    await this.get(ctx, id);
    const { status } = z.object({ status: editableAcquisitionStatusSchema }).parse(raw);
    const result = await this.db.acquisitionLead.updateMany({
      where: { id, tenantId: null },
      data: { status },
    });
    if (!result.count) throw new AppError(ErrorCode.CONFLICT, 'Este lead já foi convertido.');
    return this.get(ctx, id);
  }

  async convert(
    ctx: RequestContext,
    id: string,
    raw: unknown,
    credentials: {
      hashPassword: (password: string) => Promise<string>;
      issuer: string;
    },
  ) {
    await this.get(ctx, id);
    const input = provisionTenantSchema.parse(raw);
    const slug =
      input.slug ??
      input.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    if (!slug) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Informe um slug válido.');
    const hash = await credentials.hashPassword(input.ownerPassword);
    try {
      return await this.db.$transaction(async (tx) => {
        // A row lock serializes conversion and status changes across all instances.
        await tx.$queryRaw`SELECT id FROM acquisition_leads WHERE id = ${id}::uuid FOR UPDATE`;
        const lead = await tx.acquisitionLead.findUniqueOrThrow({ where: { id } });
        if (lead.tenantId) throw new AppError(ErrorCode.CONFLICT, 'Este lead já foi convertido.');
        const existing = await tx.authUser.findFirst({
          where: { email: { equals: input.ownerEmail, mode: 'insensitive' } },
        });
        if (existing)
          throw new AppError(ErrorCode.CONFLICT, 'Já existe uma conta com este e-mail.');
        const tenant = await tx.tenant.create({
          data: {
            id: createId(),
            name: input.name,
            slug,
            timezone: input.timezone,
            currency: input.currency,
          },
        });
        const authId = createId();
        await tx.authUser.create({
          data: { id: authId, name: input.ownerName, email: input.ownerEmail, emailVerified: true },
        });
        await tx.authAccount.create({
          data: {
            id: createId(),
            issuer: credentials.issuer,
            accountId: authId,
            providerId: 'credential',
            userId: authId,
            password: hash,
          },
        });
        const user = await tx.user.create({
          data: {
            id: createId(),
            externalAuthId: authId,
            name: input.ownerName,
            email: input.ownerEmail,
          },
        });
        const membership = await tx.membership.create({
          data: { id: createId(), tenantId: tenant.id, userId: user.id, role: 'owner' },
        });
        await tx.acquisitionLead.update({
          where: { id },
          data: { status: 'converted', tenantId: tenant.id },
        });
        await tx.auditLog.createMany({
          data: [
            { action: AuditAction.TENANT_CREATED, entityType: 'tenant', entityId: tenant.id },
            { action: AuditAction.USER_CREATED, entityType: 'user', entityId: user.id },
            {
              action: AuditAction.MEMBERSHIP_CREATED,
              entityType: 'membership',
              entityId: membership.id,
            },
            { action: 'acquisition_lead.converted', entityType: 'acquisition_lead', entityId: id },
          ].map((event) => ({
            ...event,
            id: createId(),
            tenantId: tenant.id,
            operatorId: ctx.operatorId,
            actorType: 'operator',
            ip: ctx.ip,
            metadata: { acquisitionLeadId: id },
          })),
        });
        return { tenant, user, membership };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(
          ErrorCode.CONFLICT,
          'Já existe uma empresa com este slug ou uma conta com este e-mail.',
        );
      }
      throw error;
    }
  }
}
