/**
 * Catalog embedding text. Customer.document / email / phone never enter the vector.
 * Product.cost is internal and is excluded; price is catalog.
 */

export function productEmbeddingText(product: {
  name: string;
  sku?: string | null;
  category?: string | null;
  supplier?: string | null;
  price?: unknown;
}): string {
  const price =
    product.price == null || product.price === ''
      ? null
      : typeof product.price === 'object' && product.price && 'toString' in product.price
        ? String((product.price as { toString(): string }).toString())
        : String(product.price);
  return [product.name, product.sku, product.category, product.supplier, price]
    .filter((part): part is string => Boolean(part && String(part).trim()))
    .join(' | ');
}

export function customerEmbeddingText(customer: {
  name: string;
  segment?: string | null;
  city?: string | null;
  state?: string | null;
  acquisitionSource?: string | null;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
}): string {
  const { document: _document, email: _email, phone: _phone, ...safe } = customer;
  void _document;
  void _email;
  void _phone;
  return [safe.name, safe.segment, safe.city, safe.state, safe.acquisitionSource]
    .filter((part): part is string => Boolean(part && String(part).trim()))
    .join(' | ');
}
