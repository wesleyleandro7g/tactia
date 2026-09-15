import type {
  ActivityRepository,
  CampaignRepository,
  CustomerRepository,
  ExpenseRepository,
  InteractionRepository,
  InventoryLevelRepository,
  LeadRepository,
  PaymentRepository,
  ProductRepository,
  SaleRepository,
  SellerRepository,
} from '@tactia/database';
import { applyTransform } from './transforms';
import type { FieldMapping, RawRow } from './types';

export type NormalizerRepositories = {
  customers: CustomerRepository;
  products: ProductRepository;
  sellers: SellerRepository;
  sales: SaleRepository;
  interactions: InteractionRepository;
  leads: LeadRepository;
  activities: ActivityRepository;
  expenses: ExpenseRepository;
  payments: PaymentRepository;
  inventoryLevels: InventoryLevelRepository;
  campaigns: CampaignRepository;
};

/**
 * Canonical entities are upserted in dependency order: a sale can only be
 * written after its customer, product and seller exist (spec §38).
 * Payment is after sale because it requires saleId.
 */
export const CANONICAL_ENTITY_ORDER = [
  'customer',
  'product',
  'seller',
  'lead',
  'activity',
  'expense',
  'inventory_level',
  'campaign',
  'interaction',
  'sale',
  'payment',
] as const;

export function canonicalEntityRank(entityType: string): number {
  const index = (CANONICAL_ENTITY_ORDER as readonly string[]).indexOf(entityType);
  return index === -1 ? CANONICAL_ENTITY_ORDER.length : index;
}

export type NormalizeOutcome =
  | { status: 'created' | 'updated' }
  | { status: 'skipped'; reason: string; sample?: unknown };

export function normalizeRow(row: RawRow, fieldMappings: FieldMapping[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const fm of fieldMappings) {
    result[fm.target] = applyTransform(row[fm.source], fm.transform);
  }
  return result;
}

export const CUSTOM_MAPPING_PREFIX = 'custom:';

export function extractCustomData(normalized: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(normalized)) {
    if (!key.startsWith(CUSTOM_MAPPING_PREFIX)) continue;
    const fieldKey = key.slice(CUSTOM_MAPPING_PREFIX.length);
    if (fieldKey) out[fieldKey] = value;
  }
  return out;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function date(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = str(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text = str(value)?.toLowerCase();
  if (!text) return false;
  return text === 'true' || text === '1' || text === 'yes' || text === 'sim';
}

const SALE_STATUSES = new Set(['pending', 'confirmed', 'cancelled', 'refunded']);
const INTERACTION_CHANNELS = new Set(['whatsapp', 'email', 'note', 'other']);
const INTERACTION_DIRECTIONS = new Set(['inbound', 'outbound', 'internal']);
const LEAD_STATUSES = new Set(['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']);
const ACTIVITY_TYPES = new Set([
  'call',
  'email',
  'meeting',
  'message',
  'note',
  'task',
  'proposal',
  'status_change',
]);
const PAYMENT_STATUSES = new Set(['pending', 'paid', 'overdue', 'cancelled']);

/**
 * Resolves a reference by `external_id`, preferring the same DataSource and
 * falling back to the tenant. The fallback exists because the onboarding wizard
 * creates one DataSource per CSV file: a sales file and its customers file are
 * different sources of the same origin system.
 */
async function resolveRef<T>(
  lookup: (params: {
    tenantId: string;
    dataSourceId?: string;
    externalId: string;
  }) => Promise<T | null>,
  tenantId: string,
  dataSourceId: string,
  externalId: string,
): Promise<T | null> {
  const scoped = await lookup({ tenantId, dataSourceId, externalId });
  if (scoped) return scoped;
  return lookup({ tenantId, externalId });
}

/**
 * Upserts one normalized record into the canonical model (spec §37 step
 * "normalize → upsert", §38 idempotency by `(tenant, data_source, external_id)`).
 *
 * Returns `skipped` with a reason instead of throwing: a single bad row must not
 * abort an import, and the reason ends up in the DataQualityReport (spec §56).
 */
export async function normalizeToCanonical(
  tenantId: string,
  dataSourceId: string,
  targetEntity: string,
  normalized: Record<string, unknown>,
  repositories: NormalizerRepositories,
  customData: Record<string, unknown> = {},
): Promise<NormalizeOutcome> {
  const externalId = str(normalized['external_id']);

  switch (targetEntity) {
    case 'customer': {
      if (!externalId) return { status: 'skipped', reason: 'missing_external_id' };
      const name = str(normalized['name']);
      if (!name) return { status: 'skipped', reason: 'customer_without_name', sample: externalId };
      const { created } = await repositories.customers.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        name,
        email: str(normalized['email']),
        phone: str(normalized['phone']),
        document: str(normalized['document']),
        segment: str(normalized['segment']),
        city: str(normalized['city']),
        state: str(normalized['state']),
        acquisitionSource: str(normalized['acquisition_source']),
        customData,
      });
      return { status: created ? 'created' : 'updated' };
    }

    case 'product': {
      if (!externalId) return { status: 'skipped', reason: 'missing_external_id' };
      const name = str(normalized['name']);
      if (!name) return { status: 'skipped', reason: 'product_without_name', sample: externalId };
      const { created } = await repositories.products.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        name,
        sku: str(normalized['sku']),
        category: str(normalized['category']),
        supplier: str(normalized['supplier']),
        price: num(normalized['price']),
        cost: num(normalized['cost']),
        customData,
      });
      return { status: created ? 'created' : 'updated' };
    }

    case 'seller': {
      if (!externalId) return { status: 'skipped', reason: 'missing_external_id' };
      const name = str(normalized['name']);
      if (!name) return { status: 'skipped', reason: 'seller_without_name', sample: externalId };
      const { created } = await repositories.sellers.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        name,
        email: str(normalized['email']),
      });
      return { status: created ? 'created' : 'updated' };
    }

    case 'sale': {
      if (!externalId) return { status: 'skipped', reason: 'missing_external_id' };

      const customerExternalId = str(
        normalized['customer_external_id'] ?? normalized['customer_id'],
      );
      if (!customerExternalId) {
        return { status: 'skipped', reason: 'sale_without_customer', sample: externalId };
      }
      const customer = await resolveRef(
        (params) => repositories.customers.findByExternalId(params),
        tenantId,
        dataSourceId,
        customerExternalId,
      );
      if (!customer) {
        return { status: 'skipped', reason: 'sale_customer_not_found', sample: customerExternalId };
      }

      const soldAt = date(normalized['sold_at'] ?? normalized['date']);
      if (!soldAt) {
        return { status: 'skipped', reason: 'sale_invalid_date', sample: externalId };
      }

      const sellerExternalId = str(normalized['seller_external_id'] ?? normalized['seller_id']);
      const seller = sellerExternalId
        ? await resolveRef(
            (params) => repositories.sellers.findByExternalId(params),
            tenantId,
            dataSourceId,
            sellerExternalId,
          )
        : null;

      const productExternalId = str(normalized['product_external_id'] ?? normalized['product_id']);
      const product = productExternalId
        ? await resolveRef(
            (params) => repositories.products.findByExternalId(params),
            tenantId,
            dataSourceId,
            productExternalId,
          )
        : null;

      const quantity = num(normalized['quantity']) ?? 1;
      const discountAmount = num(normalized['discount_amount']) ?? 0;
      const unitPriceFromSource = num(normalized['unit_price']);
      const unitPrice =
        unitPriceFromSource ?? (product?.price != null ? Number(product.price) : null);

      const totalFromSource = num(normalized['total_amount'] ?? normalized['amount']);
      const totalAmount =
        totalFromSource ?? (unitPrice != null ? unitPrice * quantity - discountAmount : null);

      if (totalAmount === null) {
        return { status: 'skipped', reason: 'sale_without_amount', sample: externalId };
      }
      if (totalAmount < 0) {
        return { status: 'skipped', reason: 'sale_negative_amount', sample: totalAmount };
      }

      const rawStatus = str(normalized['status'])?.toLowerCase();
      const status = rawStatus && SALE_STATUSES.has(rawStatus) ? rawStatus : 'confirmed';

      const items = product
        ? [
            {
              productId: product.id,
              quantity,
              unitPrice: unitPrice ?? totalAmount / (quantity || 1),
              discountAmount: 0,
              totalAmount,
            },
          ]
        : [];

      const { created } = await repositories.sales.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        customerId: customer.id,
        sellerId: seller?.id ?? null,
        totalAmount,
        discountAmount,
        currency: str(normalized['currency']) ?? 'BRL',
        status: status as 'pending' | 'confirmed' | 'cancelled' | 'refunded',
        paymentMethod: str(normalized['payment_method']),
        channel: str(normalized['channel']),
        region: str(normalized['region']),
        soldAt,
        customData,
        items,
      });
      return { status: created ? 'created' : 'updated' };
    }

    case 'interaction': {
      if (!externalId) return { status: 'skipped', reason: 'missing_external_id' };
      const body = str(normalized['body'] ?? normalized['text'] ?? normalized['message']);
      if (!body) return { status: 'skipped', reason: 'interaction_without_body', sample: externalId };

      const occurredAt = date(normalized['occurred_at'] ?? normalized['date'] ?? normalized['sent_at']);
      if (!occurredAt) {
        return { status: 'skipped', reason: 'interaction_invalid_date', sample: externalId };
      }

      const customerExternalId = str(
        normalized['customer_external_id'] ?? normalized['customer_id'],
      );
      const customerEmail = str(normalized['customer_email'] ?? normalized['email']);
      const customerPhone = str(normalized['customer_phone'] ?? normalized['phone']);

      let customerId: string | null = null;
      if (customerExternalId) {
        const customer = await resolveRef(
          (params) => repositories.customers.findByExternalId(params),
          tenantId,
          dataSourceId,
          customerExternalId,
        );
        customerId = customer?.id ?? null;
      }
      if (!customerId && customerEmail) {
        const customer = await repositories.customers.findByEmail({
          tenantId,
          email: customerEmail,
        });
        customerId = customer?.id ?? null;
      }
      if (!customerId && customerPhone) {
        const customer = await repositories.customers.findByPhone({
          tenantId,
          phone: customerPhone,
        });
        customerId = customer?.id ?? null;
      }

      const rawChannel = str(normalized['channel'])?.toLowerCase();
      const channel =
        rawChannel && INTERACTION_CHANNELS.has(rawChannel) ? rawChannel : 'other';
      const rawDirection = str(normalized['direction'])?.toLowerCase();
      const direction =
        rawDirection && INTERACTION_DIRECTIONS.has(rawDirection) ? rawDirection : 'inbound';

      const { created } = await repositories.interactions.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        customerId,
        channel: channel as 'whatsapp' | 'email' | 'note' | 'other',
        direction: direction as 'inbound' | 'outbound' | 'internal',
        subject: str(normalized['subject']),
        body,
        occurredAt,
      });
      return { status: created ? 'created' : 'updated' };
    }

    case 'lead': {
      if (!externalId) return { status: 'skipped', reason: 'missing_external_id' };
      const name = str(normalized['name']);
      if (!name) return { status: 'skipped', reason: 'lead_without_name', sample: externalId };

      const customerExternalId = str(
        normalized['customer_external_id'] ?? normalized['customer_id'],
      );
      const customer = customerExternalId
        ? await resolveRef(
            (params) => repositories.customers.findByExternalId(params),
            tenantId,
            dataSourceId,
            customerExternalId,
          )
        : null;

      const sellerExternalId = str(normalized['seller_external_id'] ?? normalized['seller_id']);
      const seller = sellerExternalId
        ? await resolveRef(
            (params) => repositories.sellers.findByExternalId(params),
            tenantId,
            dataSourceId,
            sellerExternalId,
          )
        : null;

      const rawStatus = str(normalized['status'])?.toLowerCase();
      const status = rawStatus && LEAD_STATUSES.has(rawStatus) ? rawStatus : 'new';
      const scoreRaw = num(normalized['score']);

      const { created } = await repositories.leads.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        name,
        email: str(normalized['email']),
        phone: str(normalized['phone']),
        source: str(normalized['source']),
        status: status as 'new' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost',
        score: scoreRaw == null ? null : Math.round(scoreRaw),
        customerId: customer?.id ?? null,
        sellerId: seller?.id ?? null,
      });
      return { status: created ? 'created' : 'updated' };
    }

    case 'activity': {
      if (!externalId) return { status: 'skipped', reason: 'missing_external_id' };
      const occurredAt = date(normalized['occurred_at'] ?? normalized['date']);
      if (!occurredAt) {
        return { status: 'skipped', reason: 'activity_invalid_date', sample: externalId };
      }

      const rawType = str(normalized['type'])?.toLowerCase();
      const type = rawType && ACTIVITY_TYPES.has(rawType) ? rawType : 'note';

      const customerExternalId = str(
        normalized['customer_external_id'] ?? normalized['customer_id'],
      );
      const customer = customerExternalId
        ? await resolveRef(
            (params) => repositories.customers.findByExternalId(params),
            tenantId,
            dataSourceId,
            customerExternalId,
          )
        : null;

      const leadExternalId = str(normalized['lead_external_id'] ?? normalized['lead_id']);
      const lead = leadExternalId
        ? await resolveRef(
            (params) => repositories.leads.findByExternalId(params),
            tenantId,
            dataSourceId,
            leadExternalId,
          )
        : null;

      const sellerExternalId = str(normalized['seller_external_id'] ?? normalized['seller_id']);
      const seller = sellerExternalId
        ? await resolveRef(
            (params) => repositories.sellers.findByExternalId(params),
            tenantId,
            dataSourceId,
            sellerExternalId,
          )
        : null;

      const { created } = await repositories.activities.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        type: type as
          | 'call'
          | 'email'
          | 'meeting'
          | 'message'
          | 'note'
          | 'task'
          | 'proposal'
          | 'status_change',
        occurredAt,
        customerId: customer?.id ?? null,
        leadId: lead?.id ?? null,
        sellerId: seller?.id ?? null,
      });
      return { status: created ? 'created' : 'updated' };
    }

    case 'expense': {
      if (!externalId) return { status: 'skipped', reason: 'missing_external_id' };
      const category = str(normalized['category']);
      if (!category) return { status: 'skipped', reason: 'expense_without_category', sample: externalId };
      const amount = num(normalized['amount']);
      if (amount === null) {
        return { status: 'skipped', reason: 'expense_without_amount', sample: externalId };
      }
      const occurredAt = date(normalized['occurred_at'] ?? normalized['date']);
      if (!occurredAt) {
        return { status: 'skipped', reason: 'expense_invalid_date', sample: externalId };
      }

      const { created } = await repositories.expenses.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        category,
        description: str(normalized['description']),
        amount,
        occurredAt,
        recurring: bool(normalized['recurring']),
        supplier: str(normalized['supplier']),
      });
      return { status: created ? 'created' : 'updated' };
    }

    case 'payment': {
      if (!externalId) return { status: 'skipped', reason: 'missing_external_id' };
      const saleExternalId = str(normalized['sale_external_id'] ?? normalized['sale_id']);
      if (!saleExternalId) {
        return { status: 'skipped', reason: 'payment_without_sale', sample: externalId };
      }
      const sale = await resolveRef(
        (params) => repositories.sales.findByExternalId(params),
        tenantId,
        dataSourceId,
        saleExternalId,
      );
      if (!sale) {
        return { status: 'skipped', reason: 'payment_sale_not_found', sample: saleExternalId };
      }
      const amount = num(normalized['amount']);
      if (amount === null) {
        return { status: 'skipped', reason: 'payment_without_amount', sample: externalId };
      }
      const dueAt = date(normalized['due_at'] ?? normalized['date']);
      if (!dueAt) {
        return { status: 'skipped', reason: 'payment_invalid_date', sample: externalId };
      }
      const paidAt = date(normalized['paid_at']);
      const rawStatus = str(normalized['status'])?.toLowerCase();
      const status =
        rawStatus && PAYMENT_STATUSES.has(rawStatus)
          ? rawStatus
          : paidAt
            ? 'paid'
            : 'pending';

      const { created } = await repositories.payments.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        saleId: sale.id,
        amount,
        method: str(normalized['method'] ?? normalized['payment_method']),
        dueAt,
        paidAt,
        status: status as 'pending' | 'paid' | 'overdue' | 'cancelled',
      });
      return { status: created ? 'created' : 'updated' };
    }

    case 'inventory_level': {
      if (!externalId) return { status: 'skipped', reason: 'missing_external_id' };
      const productExternalId = str(
        normalized['product_external_id'] ?? normalized['product_id'],
      );
      if (!productExternalId) {
        return { status: 'skipped', reason: 'inventory_without_product', sample: externalId };
      }
      const product = await resolveRef(
        (params) => repositories.products.findByExternalId(params),
        tenantId,
        dataSourceId,
        productExternalId,
      );
      if (!product) {
        return { status: 'skipped', reason: 'inventory_product_not_found', sample: productExternalId };
      }
      const quantity = num(normalized['quantity']);
      if (quantity === null) {
        return { status: 'skipped', reason: 'inventory_without_quantity', sample: externalId };
      }
      const recordedAt = date(normalized['recorded_at'] ?? normalized['date']);
      if (!recordedAt) {
        return { status: 'skipped', reason: 'inventory_invalid_date', sample: externalId };
      }

      const { created } = await repositories.inventoryLevels.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        productId: product.id,
        quantity,
        minQuantity: num(normalized['min_quantity']),
        recordedAt,
      });
      return { status: created ? 'created' : 'updated' };
    }

    case 'campaign': {
      if (!externalId) return { status: 'skipped', reason: 'missing_external_id' };
      const name = str(normalized['name']);
      if (!name) return { status: 'skipped', reason: 'campaign_without_name', sample: externalId };
      const source = str(normalized['source']);
      if (!source) return { status: 'skipped', reason: 'campaign_without_source', sample: externalId };
      const spend = num(normalized['spend'] ?? normalized['amount']);
      if (spend === null) {
        return { status: 'skipped', reason: 'campaign_without_spend', sample: externalId };
      }
      const startsAt = date(normalized['starts_at'] ?? normalized['date']);
      if (!startsAt) {
        return { status: 'skipped', reason: 'campaign_invalid_date', sample: externalId };
      }

      const { created } = await repositories.campaigns.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        name,
        source,
        spend,
        startsAt,
        endsAt: date(normalized['ends_at']),
      });
      return { status: created ? 'created' : 'updated' };
    }

    default:
      return { status: 'skipped', reason: `unsupported_target_entity:${targetEntity}` };
  }
}
