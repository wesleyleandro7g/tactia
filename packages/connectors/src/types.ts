export type FieldTransform = 'trim' | 'number' | 'date' | 'currency' | 'none';

export type FieldMapping = {
  source: string;
  target: string;
  transform?: FieldTransform;
};

export type MappingConfig = {
  fields: FieldMapping[];
};

export type ConnectionTestResult = {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
};

export type DiscoveryColumn = {
  name: string;
  type: string;
  nullable: boolean;
};

export type DiscoveryResource = {
  name: string;
  columns: DiscoveryColumn[];
  sampleRows?: Record<string, unknown>[];
};

export type DiscoveryResult = {
  resources: DiscoveryResource[];
};

export type SyncMode = 'full' | 'incremental';

export type FetchOptions = {
  limit?: number;
  offset?: number;
  /** Source column used as the incremental watermark (quoted by the connector). */
  dateColumn?: string;
  since?: Date;
};

export type RawRow = Record<string, unknown>;

export type SyncContext = {
  tenantId: string;
  dataSourceId: string;
  syncJobId: string;
  mappings: Array<{
    sourceEntity: string;
    targetEntity: string;
    configuration: MappingConfig;
  }>;
  mode?: SyncMode;
  since?: Date;
  onProgress?: (counters: {
    read: number;
    created: number;
    updated: number;
    failed: number;
  }) => void;
};

export type SkippedMapping = {
  sourceEntity: string;
  targetEntity: string;
  reason: 'incremental_missing_date_column';
};

export type SyncResult = {
  recordsRead: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  skippedMappings?: SkippedMapping[];
};

export interface Connector {
  testConnection(): Promise<ConnectionTestResult>;
  discover(): Promise<DiscoveryResult>;
  fetch(resource: string, options?: FetchOptions): Promise<RawRow[]>;
  normalize(row: RawRow, fieldMappings: FieldMapping[]): Record<string, unknown>;
  sync(context: SyncContext): Promise<SyncResult>;
}
