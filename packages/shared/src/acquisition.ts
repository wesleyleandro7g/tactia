import { z } from 'zod';

export const ACQUISITION_SEGMENTS = [
  'Comércio',
  'Serviços',
  'Indústria',
  'Saúde',
  'Educação',
  'Tecnologia',
  'Alimentação',
  'Outros',
] as const;
export const ACQUISITION_EMPLOYEES = ['Só eu', '2–10', '11–50', '51–200', 'Mais de 200'] as const;
export const ACQUISITION_REVENUES = [
  'Até R$ 10 mil',
  'Acima de R$ 10 mil até R$ 50 mil',
  'Acima de R$ 50 mil até R$ 100 mil',
  'Acima de R$ 100 mil até R$ 500 mil',
  'Acima de R$ 500 mil',
  'Prefiro não informar',
] as const;
export const ACQUISITION_SYSTEMS = [
  'ERP',
  'CRM',
  'Planilhas',
  'Notion',
  'Outros',
  'Nenhum',
] as const;
export const ACQUISITION_STATUSES = {
  new: 'Novo',
  contacted: 'Em contato',
  scheduled: 'Consultoria agendada',
  qualified: 'Qualificado',
  converted: 'Convertido',
  closed: 'Encerrado',
} as const;
export const acquisitionStatusSchema = z.enum([
  'new',
  'contacted',
  'scheduled',
  'qualified',
  'converted',
  'closed',
]);
export const editableAcquisitionStatusSchema = z.enum([
  'new',
  'contacted',
  'scheduled',
  'qualified',
  'closed',
]);
export const CONSULTATION_CALENDAR_URL =
  'https://calendar.google.com/calendar/appointments/schedules/AcZssZ0QYMmUig3ZFVenYDA18GuQshBVIsyL5oeUd1Xli77B8N0uh0NjWVRrgL5G_3uWPthAAw0Yeh_z?gv=true';

const text = (max: number) => z.string().trim().max(max, `Use no máximo ${max} caracteres.`);
const phone = text(30)
  .regex(/^[+\d\s().-]+$/, 'Informe um telefone válido, com DDD.')
  .transform((value) => value.replace(/\D/g, ''))
  .pipe(z.string().min(10, 'Informe o DDD e o número.').max(15, 'Número muito longo.'));
export const acquisitionFields = z.object({
  name: text(120).min(2, 'Informe seu nome.'),
  email: text(254).toLowerCase().email('Informe um e-mail válido.'),
  whatsapp: phone,
  phone: z
    .union([z.literal(''), phone])
    .optional()
    .transform((value) => value || undefined),
  company: text(120).min(2, 'Informe o nome da empresa.'),
  segment: z.enum(ACQUISITION_SEGMENTS, { message: 'Escolha um segmento.' }),
  segmentOther: text(120).optional(),
  employeeRange: z.enum(ACQUISITION_EMPLOYEES, {
    message: 'Escolha a quantidade de funcionários.',
  }),
  revenueRange: z.enum(ACQUISITION_REVENUES, {
    message: 'Escolha uma faixa ou prefira não informar.',
  }),
  systems: z
    .array(z.enum(ACQUISITION_SYSTEMS))
    .min(1, 'Escolha ao menos uma opção.')
    .max(6)
    .refine((items) => new Set(items).size === items.length, 'Remova opções repetidas.')
    .refine(
      (items) => !items.includes('Nenhum') || items.length === 1,
      'Selecione Nenhum ou os sistemas utilizados.',
    ),
  systemDetails: text(500).optional(),
  context: text(2000).optional(),
});
export const acquisitionLeadSchema = acquisitionFields
  .extend({
    submissionId: z.string().uuid(),
    website: text(200).default(''),
  })
  .superRefine((value, ctx) => {
    if (value.segment === 'Outros' && !value.segmentOther) {
      ctx.addIssue({ code: 'custom', path: ['segmentOther'], message: 'Conte qual é o segmento.' });
    }
  });
export type AcquisitionLeadInput = z.input<typeof acquisitionLeadSchema>;

/** Short consultation funnel. The original acquisition schema stays strict. */
export const consultationLeadSchema = acquisitionFields
  .pick({ name: true, email: true, whatsapp: true, company: true, context: true })
  .extend({
    submissionId: z.string().uuid(),
    website: text(200).default(''),
    attribution: z
      .object({
        utm_source: text(200).optional(),
        utm_medium: text(200).optional(),
        utm_campaign: text(200).optional(),
        utm_content: text(200).optional(),
        utm_term: text(200).optional(),
        gclid: text(200).optional(),
        fbclid: text(200).optional(),
      })
      .optional(),
  });
export type ConsultationLeadInput = z.input<typeof consultationLeadSchema>;
