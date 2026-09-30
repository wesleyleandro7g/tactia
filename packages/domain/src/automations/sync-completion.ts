import { SYNC_COMPLETED_EVENT } from './model';

/**
 * Só o sucesso completo vira evento. Parcial, falha, cancelamento e
 * "requer atenção" não disparam automações.
 */
export function syncCompletedEvent(input: {
  status: string;
  tenantId: string;
  dataSourceId: string;
  syncJobId: string;
}): {
  type: typeof SYNC_COMPLETED_EVENT;
  tenantId: string;
  sourceId: string;
  connectionId: string;
} | null {
  if (input.status !== 'completed') return null;
  return {
    type: SYNC_COMPLETED_EVENT,
    tenantId: input.tenantId,
    sourceId: input.syncJobId,
    connectionId: input.dataSourceId,
  };
}
