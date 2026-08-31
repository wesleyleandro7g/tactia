import type {
  CustomerRepository,
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
};

/**
 * Canonical entities are upserted in dependency order: a sale can only be
 * written after its customer, product and seller exist (spec §38).
 */
export const CANONICAL_ENTITY_ORDER = ['customer', 'product', 'seller', 'sale'] as const;

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

const SALE_STATUSES = new Set(['pending', 'confirmed', 'cancelled', 'refunded']);

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
        price: num(normalized['price']),
        cost: num(normalized['cost']),
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
        soldAt,
        items,
      });
      return { status: created ? 'created' : 'updated' };
    }

    default:
      return { status: 'skipped', reason: `unsupported_target_entity:${targetEntity}` };
  }
}
