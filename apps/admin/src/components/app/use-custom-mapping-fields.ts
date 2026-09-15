'use client';

import { useEffect, useMemo, useState } from 'react';
import { customMappingFields, type MappingField } from '@tactia/domain/data-sources/import-mapping';

type FieldRow = { entityType: string; fieldKey: string; label: string };

export function useCustomMappingFields(tenantId: string, entityType: string): MappingField[] {
  const [items, setItems] = useState<FieldRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v1/tenants/${tenantId}/custom-fields`)
      .then((response) => response.json())
      .then((payload: { data?: { items?: FieldRow[] } }) => {
        if (!cancelled) setItems(payload.data?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return useMemo(
    () => customMappingFields(items.filter((item) => item.entityType === entityType)),
    [items, entityType],
  );
}
