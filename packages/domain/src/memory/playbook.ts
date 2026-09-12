import { z } from 'zod';

export const playbookStepSchema = z.object({
  ordinal: z.number().int().min(1),
  text: z.string().min(1).max(500),
  actionType: z.enum(['create_task', 'send_email']).optional(),
});

export type PlaybookStep = z.infer<typeof playbookStepSchema>;

export const playbookSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]{2,64}$/, 'Slug deve ter 2–64 caracteres [a-z0-9-]');

export const createPlaybookSchema = z.object({
  slug: playbookSlugSchema,
  title: z.string().trim().min(1).max(160),
  trigger: z.string().trim().min(1).max(500),
  steps: z.array(playbookStepSchema).min(1).max(20),
  enabled: z.boolean().optional().default(true),
});

export const updatePlaybookSchema = z.object({
  slug: playbookSlugSchema.optional(),
  title: z.string().trim().min(1).max(160).optional(),
  trigger: z.string().trim().min(1).max(500).optional(),
  steps: z.array(playbookStepSchema).min(1).max(20).optional(),
  enabled: z.boolean().optional(),
});

export const DEMO_PLAYBOOK_RECLAMACAO_ATRASO = {
  slug: 'reclamacao-atraso',
  title: 'Reclamação de atraso',
  trigger: 'cliente reclama de atraso na entrega ou logística',
  steps: [
    { ordinal: 1, text: 'Confirmar pedido e prazo no cadastro' },
    { ordinal: 2, text: 'Criar tarefa para o vendedor responsável no mesmo dia', actionType: 'create_task' as const },
    { ordinal: 3, text: 'Criar tarefa para logística com o número do pedido', actionType: 'create_task' as const },
    {
      ordinal: 4,
      text: 'Só então oferecer e-mail de desculpas se o atraso for nosso',
      actionType: 'send_email' as const,
    },
  ],
};

export function playbookEmbeddingText(input: {
  title: string;
  trigger: string;
  steps: Array<{ text: string }>;
}): string {
  return [input.title, input.trigger, ...input.steps.map((step) => step.text)].join('\n');
}
