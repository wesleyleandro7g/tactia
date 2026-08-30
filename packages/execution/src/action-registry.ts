import { ZodError, type z } from 'zod';
import type { ActionType } from '@tactia/database';
import { AppError, ErrorCode } from '@tactia/shared';
import type { ActionDefinition, ActionExecutorContext, ActionOutput } from './types';

/**
 * Helper to author an action with a typed input. The input is validated with
 * Zod *before* the executor runs — the engine never hands raw payloads (much
 * less LLM output) to an executor (spec §44, §45).
 */
export function defineAction<TSchema extends z.ZodTypeAny>(definition: {
  type: ActionType;
  name: string;
  description: string;
  defaultRequiresApproval: boolean;
  inputSchema: TSchema;
  execute: (
    context: ActionExecutorContext,
    input: z.infer<TSchema>,
  ) => Promise<ActionOutput>;
}): ActionDefinition {
  return {
    type: definition.type,
    name: definition.name,
    description: definition.description,
    defaultRequiresApproval: definition.defaultRequiresApproval,
    inputSchema: definition.inputSchema,
    async execute(context: ActionExecutorContext, input: unknown) {
      const parsed = definition.inputSchema.parse(input ?? {}) as z.infer<TSchema>;
      return definition.execute(context, parsed);
    },
  };
}

/**
 * Action Registry: the catalog of what Tactia knows how to execute.
 *
 * A type without a registered executor can never be proposed — that is what
 * keeps the `ActionType` enum (which mirrors the spec) from producing
 * unrunnable executions.
 */
export class ActionRegistry {
  private readonly actions = new Map<ActionType, ActionDefinition>();

  constructor(definitions: ActionDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: ActionDefinition): this {
    if (this.actions.has(definition.type)) {
      throw new AppError(ErrorCode.CONFLICT, `Action '${definition.type}' is already registered`);
    }
    this.actions.set(definition.type, definition);
    return this;
  }

  has(type: ActionType): boolean {
    return this.actions.has(type);
  }

  get(type: ActionType): ActionDefinition {
    const definition = this.actions.get(type);
    if (!definition) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Ação '${type}' não é suportada nesta versão. Disponíveis: ${this.types().join(', ')}.`,
      );
    }
    return definition;
  }

  types(): ActionType[] {
    return [...this.actions.keys()];
  }

  list(): ActionDefinition[] {
    return [...this.actions.values()];
  }

  /** Validates a payload against the action schema, classifying Zod errors. */
  validate(type: ActionType, input: unknown): unknown {
    const definition = this.get(type);
    try {
      return definition.inputSchema.parse(input ?? {});
    } catch (error) {
      if (error instanceof ZodError) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Input inválido para a ação '${type}'`,
          error.flatten(),
        );
      }
      throw error;
    }
  }
}
