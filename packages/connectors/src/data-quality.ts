export type QualityIssue = {
  rule: string;
  count: number;
  sample?: unknown;
};

export type DataQualityCheckResult = {
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  warnings: QualityIssue[];
  errors: QualityIssue[];
};

type NormalizedRecord = Record<string, unknown>;

export function runDataQualityChecks(
  entityType: string,
  records: NormalizedRecord[],
): DataQualityCheckResult {
  const warnings: Map<string, { count: number; sample?: unknown }> = new Map();
  const errors: Map<string, { count: number; sample?: unknown }> = new Map();
  const externalIds = new Set<string>();
  let invalidCount = 0;

  const addIssue = (
    map: Map<string, { count: number; sample?: unknown }>,
    rule: string,
    sample?: unknown,
  ) => {
    const existing = map.get(rule);
    if (existing) existing.count++;
    else map.set(rule, { count: 1, sample });
  };

  for (const record of records) {
    let isValid = true;

    // Common checks
    const externalId = record['external_id'] as string | undefined;
    if (externalId) {
      if (externalIds.has(externalId)) {
        addIssue(errors, 'duplicated_external_id', externalId);
        isValid = false;
      } else {
        externalIds.add(externalId);
      }
    }

    // Entity-specific checks
    switch (entityType) {
      case 'customer':
        if (!record['name'] || String(record['name']).trim() === '') {
          addIssue(errors, 'customer_without_name', record);
          isValid = false;
        }
        break;

      case 'sale': {
        if (!record['customer_id'] && !record['customer_external_id']) {
          addIssue(errors, 'sale_without_customer', record);
          isValid = false;
        }
        const amount = Number(record['total_amount'] ?? record['amount'] ?? 0);
        if (amount < 0) {
          addIssue(errors, 'sale_negative_amount', { amount });
          isValid = false;
        }
        if (!record['seller_id'] && !record['seller_external_id']) {
          addIssue(warnings, 'sale_missing_seller', undefined);
        }
        const soldAt = record['sold_at'] ?? record['date'];
        if (soldAt) {
          const d = new Date(String(soldAt));
          if (isNaN(d.getTime())) {
            addIssue(errors, 'sale_invalid_date', soldAt);
            isValid = false;
          }
        }
        break;
      }

      case 'product':
        if (!record['name'] || String(record['name']).trim() === '') {
          addIssue(errors, 'product_without_name', record);
          isValid = false;
        }
        if (record['price'] == null) {
          addIssue(warnings, 'product_without_price', undefined);
        }
        break;

      case 'interaction': {
        const body = record['body'] ?? record['text'] ?? record['message'];
        if (!body || String(body).trim() === '') {
          addIssue(errors, 'interaction_without_body', record);
          isValid = false;
        }
        const occurredAt = record['occurred_at'] ?? record['date'] ?? record['sent_at'];
        if (!occurredAt) {
          addIssue(errors, 'interaction_invalid_date', record);
          isValid = false;
        } else {
          const parsed = new Date(String(occurredAt));
          if (Number.isNaN(parsed.getTime())) {
            addIssue(errors, 'interaction_invalid_date', occurredAt);
            isValid = false;
          }
        }
        if (!record['external_id']) {
          addIssue(errors, 'missing_external_id', record);
          isValid = false;
        }
        break;
      }

      case 'lead':
        if (!record['name'] || String(record['name']).trim() === '') {
          addIssue(errors, 'lead_without_name', record);
          isValid = false;
        }
        if (!record['external_id']) {
          addIssue(errors, 'missing_external_id', record);
          isValid = false;
        }
        break;

      case 'activity': {
        const occurredAt = record['occurred_at'] ?? record['date'];
        if (!occurredAt) {
          addIssue(errors, 'activity_invalid_date', record);
          isValid = false;
        } else {
          const parsed = new Date(String(occurredAt));
          if (Number.isNaN(parsed.getTime())) {
            addIssue(errors, 'activity_invalid_date', occurredAt);
            isValid = false;
          }
        }
        if (!record['external_id']) {
          addIssue(errors, 'missing_external_id', record);
          isValid = false;
        }
        break;
      }

      case 'expense': {
        if (!record['category'] || String(record['category']).trim() === '') {
          addIssue(errors, 'expense_without_category', record);
          isValid = false;
        }
        if (record['amount'] == null || record['amount'] === '') {
          addIssue(errors, 'expense_without_amount', record);
          isValid = false;
        }
        const occurredAt = record['occurred_at'] ?? record['date'];
        if (!occurredAt) {
          addIssue(errors, 'expense_invalid_date', record);
          isValid = false;
        }
        if (!record['external_id']) {
          addIssue(errors, 'missing_external_id', record);
          isValid = false;
        }
        break;
      }

      case 'payment': {
        if (!record['sale_id'] && !record['sale_external_id']) {
          addIssue(errors, 'payment_without_sale', record);
          isValid = false;
        }
        if (record['amount'] == null || record['amount'] === '') {
          addIssue(errors, 'payment_without_amount', record);
          isValid = false;
        }
        const dueAt = record['due_at'] ?? record['date'];
        if (!dueAt) {
          addIssue(errors, 'payment_invalid_date', record);
          isValid = false;
        }
        if (!record['external_id']) {
          addIssue(errors, 'missing_external_id', record);
          isValid = false;
        }
        break;
      }

      case 'inventory_level': {
        if (!record['product_id'] && !record['product_external_id']) {
          addIssue(errors, 'inventory_without_product', record);
          isValid = false;
        }
        if (record['quantity'] == null || record['quantity'] === '') {
          addIssue(errors, 'inventory_without_quantity', record);
          isValid = false;
        }
        const recordedAt = record['recorded_at'] ?? record['date'];
        if (!recordedAt) {
          addIssue(errors, 'inventory_invalid_date', record);
          isValid = false;
        }
        if (!record['external_id']) {
          addIssue(errors, 'missing_external_id', record);
          isValid = false;
        }
        break;
      }

      case 'campaign': {
        if (!record['name'] || String(record['name']).trim() === '') {
          addIssue(errors, 'campaign_without_name', record);
          isValid = false;
        }
        if (!record['source'] || String(record['source']).trim() === '') {
          addIssue(errors, 'campaign_without_source', record);
          isValid = false;
        }
        if (record['spend'] == null && record['amount'] == null) {
          addIssue(errors, 'campaign_without_spend', record);
          isValid = false;
        }
        const startsAt = record['starts_at'] ?? record['date'];
        if (!startsAt) {
          addIssue(errors, 'campaign_invalid_date', record);
          isValid = false;
        }
        if (!record['external_id']) {
          addIssue(errors, 'missing_external_id', record);
          isValid = false;
        }
        break;
      }
    }

    if (!isValid) invalidCount++;
  }

  const toIssueList = (map: Map<string, { count: number; sample?: unknown }>): QualityIssue[] =>
    Array.from(map.entries()).map(([rule, { count, sample }]) => ({ rule, count, sample }));

  return {
    totalRecords: records.length,
    validRecords: records.length - invalidCount,
    invalidRecords: invalidCount,
    warnings: toIssueList(warnings),
    errors: toIssueList(errors),
  };
}
