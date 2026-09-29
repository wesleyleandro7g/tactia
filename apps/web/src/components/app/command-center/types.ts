export type Availability = 'ready' | 'empty' | 'partial' | 'stale' | 'error';
export type EvidenceKind = 'observed' | 'reported' | 'inferred';

export type EvidenceView = {
  id: string;
  kind: EvidenceKind;
  summary: string;
  sourceLabel: string;
  eventAt: string | null;
  ingestedAt: string;
  validUntil?: string | null;
};

export type ObjectiveView = {
  id: string;
  title: string | null;
  status: string;
  metricKey: string;
  target: number;
  baselineValue: number | null;
  periodType: string;
  periodStart: string;
  version: number;
  plans?: Array<{ id: string; title: string; status: string; version: number; updatedAt: string }>;
};

export type ExecutionView = {
  id: string;
  status: string;
  origin: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  action: { name: string; type: string };
};

export type PlanStepView = {
  id: string;
  position: number;
  title: string;
  description: string | null;
  status: string;
  executions: Array<{ id: string; actionExecution: ExecutionView }>;
  evidence: EvidenceView[];
};

export type MeasurementReviewView = {
  id: string;
  status: string;
  observed: number | null;
  operationalResults: unknown;
  references: unknown;
  limitation: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type MeasurementDefinitionView = {
  id: string;
  metricKey: string;
  indicator: string;
  unit: string;
  baseline: number | null;
  target: number | null;
  windowFrom: string;
  windowTo: string;
  attribution: string;
  sources: unknown;
  version: number;
  reviews: MeasurementReviewView[];
};

export type PlanView = {
  id: string;
  recommendationId: string | null;
  title: string;
  summary: string | null;
  scope: unknown;
  responsibleLabel: string | null;
  status: string;
  version: number;
  nextReviewAt: string | null;
  updatedAt: string;
  goal: ObjectiveView;
  steps: PlanStepView[];
  evidence: EvidenceView[];
  measurementDefinitions: MeasurementDefinitionView[];
  reviewDecisions: Array<{
    id: string;
    choice: string;
    reason: string | null;
    fromVersion: number;
    toVersion: number;
    createdAt: string;
  }>;
  gaps: Array<{ id: string; subject: string; reason: string; impact: string; status: string }>;
};
