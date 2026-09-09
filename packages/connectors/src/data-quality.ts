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
