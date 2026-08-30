import type {
  CustomerRepository,
  ProductRepository,
  SellerRepository,
} from '@tactia/database';
import { applyTransform } from './transforms';
import type { FieldMapping, RawRow } from './types';

export type NormalizerRepositories = {
  customers: CustomerRepository;
  products: ProductRepository;
  sellers: SellerRepository;
};

export function normalizeRow(row: RawRow, fieldMappings: FieldMapping[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const fm of fieldMappings) {
    result[fm.target] = applyTransform(row[fm.source], fm.transform);
  }
  return result;
}

export async function normalizeToCanonical(
  tenantId: string,
  dataSourceId: string,
  targetEntity: string,
  normalized: Record<string, unknown>,
  repositories: NormalizerRepositories,
): Promise<'created' | 'updated' | 'skipped'> {
  const externalId = normalized['external_id'] as string | undefined;

  switch (targetEntity) {
    case 'customer': {
      if (!normalized['name'] || !externalId) return 'skipped';
      const { created } = await repositories.customers.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        name: String(normalized['name']),
        email: normalized['email'] ? String(normalized['email']) : null,
        phone: normalized['phone'] ? String(normalized['phone']) : null,
        document: normalized['document'] ? String(normalized['document']) : null,
      });
      return created ? 'created' : 'updated';
    }

    case 'product': {
      if (!normalized['name'] || !externalId) return 'skipped';
      const { created } = await repositories.products.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        name: String(normalized['name']),
        sku: normalized['sku'] ? String(normalized['sku']) : null,
        category: normalized['category'] ? String(normalized['category']) : null,
        price: normalized['price'] != null ? Number(normalized['price']) : null,
        cost: normalized['cost'] != null ? Number(normalized['cost']) : null,
      });
      return created ? 'created' : 'updated';
    }

    case 'seller': {
      if (!normalized['name'] || !externalId) return 'skipped';
      const { created } = await repositories.sellers.upsertByExternalId({
        tenantId,
        dataSourceId,
        externalId,
        name: String(normalized['name']),
        email: normalized['email'] ? String(normalized['email']) : null,
      });
      return created ? 'created' : 'updated';
    }

    default:
      return 'skipped';
  }
}
