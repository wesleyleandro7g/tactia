import type { ActionDefinition } from '../types';
import { ActionRegistry } from '../action-registry';
import { createTaskAction, type CreateTaskDeps } from './create-task';
import { sendEmailAction, type SendEmailDeps } from './send-email';

export type DefaultActionDeps = CreateTaskDeps & SendEmailDeps;

/** The 2 actions of V0.1 (plan — Etapa 7). */
export function createDefaultActions(deps: DefaultActionDeps): ActionDefinition[] {
  return [createTaskAction(deps), sendEmailAction(deps)];
}

export function createDefaultActionRegistry(deps: DefaultActionDeps): ActionRegistry {
  return new ActionRegistry(createDefaultActions(deps));
}
