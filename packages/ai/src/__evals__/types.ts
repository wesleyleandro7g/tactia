import type { MembershipRole } from '@tactia/shared';
import type { ScriptedTurn } from '../adapters/mock-llm-adapter';
import type { AiContext } from '../context-builder';
import type { ChatAnswer } from '../types';

export type EvalCase = {
  id: string;
  question: string;
  role?: MembershipRole;
  script: ScriptedTurn[];
  context?: Partial<AiContext>;
  expect?: {
    tools?: string[];
    sourcesNonEmpty?: boolean;
    guardrail?: ChatAnswer['guardrail'] | Array<NonNullable<ChatAnswer['guardrail']>>;
    forbidden?: string[];
    required?: string[];
    noProposals?: boolean;
  };
};
