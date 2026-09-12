import {
  CATALOG_SEARCH_LIMIT,
  EMBED_PENDING_BATCH,
  type CustomerRepository,
  type ProductRepository,
} from '@tactia/database';
import { logger, type RequestContext } from '@tactia/shared';
import { assertTenantContext } from '../authz';
import type { TextEmbedder } from '../ports/embedder';
import { customerEmbeddingText, productEmbeddingText } from '../memory/catalog-text';

export class CatalogEmbeddingService {
  constructor(
    private readonly products: ProductRepository,
    private readonly customers: CustomerRepository,
    private readonly embedder?: TextEmbedder | null,
  ) {}

  async embedPending({ tenantId, take = EMBED_PENDING_BATCH }: { tenantId: string; take?: number }) {
    if (!this.embedder) return { products: 0, customers: 0 };
    const [productRows, customerRows] = await Promise.all([
      this.products.findPendingEmbedding({ tenantId, take }),
      this.customers.findPendingEmbedding({ tenantId, take }),
    ]);

    let productsEmbedded = 0;
    let customersEmbedded = 0;

    if (productRows.length > 0) {
      try {
        const texts = productRows.map((row) => productEmbeddingText(row));
        const embeddings = await this.embedder.embed(texts);
        for (let index = 0; index < productRows.length; index += 1) {
          const embedding = embeddings[index];
          const row = productRows[index];
          if (!embedding || !row) continue;
          await this.products.updateEmbedding({ tenantId, id: row.id, embedding });
          productsEmbedded += 1;
        }
      } catch (error) {
        logger.warn(
          {
            tenant_id: tenantId,
            operation: 'catalog_embed_products',
            err: error instanceof Error ? error.message : String(error),
          },
          'failed to embed products',
        );
      }
    }

    if (customerRows.length > 0) {
      try {
        const texts = customerRows.map((row) => customerEmbeddingText(row));
        const embeddings = await this.embedder.embed(texts);
        for (let index = 0; index < customerRows.length; index += 1) {
          const embedding = embeddings[index];
          const row = customerRows[index];
          if (!embedding || !row) continue;
          await this.customers.updateEmbedding({ tenantId, id: row.id, embedding });
          customersEmbedded += 1;
        }
      } catch (error) {
        logger.warn(
          {
            tenant_id: tenantId,
            operation: 'catalog_embed_customers',
            err: error instanceof Error ? error.message : String(error),
          },
          'failed to embed customers',
        );
      }
    }

    return { products: productsEmbedded, customers: customersEmbedded };
  }

  async embedOneProduct(tenantId: string, product: Parameters<typeof productEmbeddingText>[0] & { id: string }) {
    if (!this.embedder) return false;
    try {
      const [embedding] = await this.embedder.embed([productEmbeddingText(product)]);
      if (!embedding) return false;
      await this.products.updateEmbedding({ tenantId, id: product.id, embedding });
      return true;
    } catch (error) {
      logger.warn(
        {
          tenant_id: tenantId,
          operation: 'catalog_embed_product',
          product_id: product.id,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to embed product',
      );
      return false;
    }
  }

  async embedOneCustomer(tenantId: string, customer: Parameters<typeof customerEmbeddingText>[0] & { id: string }) {
    if (!this.embedder) return false;
    try {
      const [embedding] = await this.embedder.embed([customerEmbeddingText(customer)]);
      if (!embedding) return false;
      await this.customers.updateEmbedding({ tenantId, id: customer.id, embedding });
      return true;
    } catch (error) {
      logger.warn(
        {
          tenant_id: tenantId,
          operation: 'catalog_embed_customer',
          customer_id: customer.id,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to embed customer',
      );
      return false;
    }
  }

  async search(
    ctx: RequestContext,
    input: { query: string; entity?: 'product' | 'customer' | 'both'; limit?: number },
  ): Promise<{
    mode: 'semantic' | 'keyword';
    products: Array<Record<string, unknown>>;
    customers: Array<Record<string, unknown>>;
  }> {
    assertTenantContext(ctx);
    const limit = input.limit ?? CATALOG_SEARCH_LIMIT;
    const entity = input.entity ?? 'both';
    const wantProducts = entity === 'product' || entity === 'both';
    const wantCustomers = entity === 'customer' || entity === 'both';

    if (this.embedder) {
      try {
        const [embedding] = await this.embedder.embed([input.query]);
        if (embedding) {
          const [products, customers] = await Promise.all([
            wantProducts
              ? this.products.searchByEmbedding({ tenantId: ctx.tenantId, embedding, limit })
              : Promise.resolve([]),
            wantCustomers
              ? this.customers.searchByEmbedding({ tenantId: ctx.tenantId, embedding, limit })
              : Promise.resolve([]),
          ]);
          return {
            mode: 'semantic',
            products: products.map((row) => serializeProduct(row)),
            customers: customers.map((row) => serializeCustomer(row)),
          };
        }
      } catch (error) {
        logger.warn(
          {
            tenant_id: ctx.tenantId,
            operation: 'catalog_search_embed',
            err: error instanceof Error ? error.message : String(error),
          },
          'catalog semantic search fell back to keyword',
        );
      }
    }

    const [products, customers] = await Promise.all([
      wantProducts
        ? this.products.searchCatalogKeyword({ tenantId: ctx.tenantId, query: input.query, limit })
        : Promise.resolve([]),
      wantCustomers
        ? this.customers.searchCatalogKeyword({ tenantId: ctx.tenantId, query: input.query, limit })
        : Promise.resolve([]),
    ]);
    return {
      mode: 'keyword',
      products: products.map((row) => serializeProduct(row)),
      customers: customers.map((row) => serializeCustomer(row)),
    };
  }
}

function serializeProduct(row: {
  id: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  supplier?: string | null;
  price?: unknown;
  score?: number;
}) {
  const price =
    row.price == null
      ? null
      : Number(
          typeof row.price === 'object' && row.price && 'toString' in row.price
            ? (row.price as { toString(): string }).toString()
            : row.price,
        );
  return {
    id: row.id,
    name: row.name,
    sku: row.sku ?? null,
    category: row.category ?? null,
    supplier: row.supplier ?? null,
    price: Number.isFinite(price) ? price : null,
    ...(row.score != null ? { score: row.score } : {}),
  };
}

function serializeCustomer(row: {
  id: string;
  name: string;
  segment?: string | null;
  city?: string | null;
  state?: string | null;
  acquisitionSource?: string | null;
  score?: number;
}) {
  return {
    id: row.id,
    name: row.name,
    segment: row.segment ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    acquisitionSource: row.acquisitionSource ?? null,
    ...(row.score != null ? { score: row.score } : {}),
  };
}
