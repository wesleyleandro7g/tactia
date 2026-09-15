import { z } from 'zod';
import { paginationQuerySchema } from '@tactia/shared';

const idSchema = z.string().uuid();
const optionalId = z.string().uuid().nullable().optional();
const metadataSchema = z.record(z.unknown()).nullable().optional();
const customDataSchema = z.record(z.unknown()).optional();
const moneySchema = z.number().finite();

export const listQuerySchema = paginationQuerySchema.extend({
  status: z.string().optional(),
  search: z.string().trim().min(1).max(120).optional(),
  customerId: z.string().uuid().optional(),
  sellerId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  type: z.string().optional(),
});

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  document: z.string().trim().max(40).nullable().optional(),
  status: z.enum(['active', 'inactive', 'blocked']).optional(),
  externalId: z.string().trim().min(1).max(120).nullable().optional(),
  metadata: metadataSchema,
  customData: customDataSchema,
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const createLeadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  source: z.string().trim().max(120).nullable().optional(),
  status: z.enum(['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']).optional(),
  score: z.number().int().min(0).max(100).nullable().optional(),
  customerId: optionalId,
  sellerId: optionalId,
  externalId: z.string().trim().min(1).max(120).nullable().optional(),
});

export const updateLeadSchema = createLeadSchema.partial();

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(80).nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  cost: moneySchema.nullable().optional(),
  price: moneySchema.nullable().optional(),
  status: z.enum(['active', 'inactive', 'discontinued']).optional(),
  externalId: z.string().trim().min(1).max(120).nullable().optional(),
  metadata: metadataSchema,
  customData: customDataSchema,
});

export const updateProductSchema = createProductSchema.partial();

export const createSellerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().nullable().optional(),
  userId: optionalId,
  status: z.enum(['active', 'inactive']).optional(),
  externalId: z.string().trim().min(1).max(120).nullable().optional(),
});

export const updateSellerSchema = createSellerSchema.partial();

export const saleItemSchema = z.object({
  productId: idSchema,
  quantity: z.number().positive(),
  unitPrice: moneySchema.nonnegative(),
  discountAmount: moneySchema.nonnegative().optional(),
  totalAmount: moneySchema.nonnegative().optional(),
  customData: customDataSchema,
});

export const createSaleSchema = z.object({
  customerId: idSchema,
  sellerId: optionalId,
  totalAmount: moneySchema.nonnegative().optional(),
  discountAmount: moneySchema.nonnegative().optional(),
  currency: z.string().length(3).optional(),
  status: z.enum(['pending', 'confirmed', 'cancelled', 'refunded']).optional(),
  soldAt: z.coerce.date(),
  externalId: z.string().trim().min(1).max(120).nullable().optional(),
  metadata: metadataSchema,
  customData: customDataSchema,
  items: z.array(saleItemSchema).min(1),
});

export const updateSaleSchema = z.object({
  customerId: idSchema.optional(),
  sellerId: optionalId,
  totalAmount: moneySchema.nonnegative().optional(),
  discountAmount: moneySchema.nonnegative().optional(),
  currency: z.string().length(3).optional(),
  status: z.enum(['pending', 'confirmed', 'cancelled', 'refunded']).optional(),
  soldAt: z.coerce.date().optional(),
  externalId: z.string().trim().min(1).max(120).nullable().optional(),
  metadata: metadataSchema,
  customData: customDataSchema,
});

export const createActivitySchema = z.object({
  type: z.enum(['call', 'email', 'meeting', 'message', 'note', 'task', 'proposal', 'status_change']),
  customerId: optionalId,
  leadId: optionalId,
  sellerId: optionalId,
  occurredAt: z.coerce.date(),
  metadata: metadataSchema,
});

export const updateActivitySchema = createActivitySchema.partial();

export const interactionChannelSchema = z.enum(['whatsapp', 'email', 'note', 'other']);
export const interactionDirectionSchema = z.enum(['inbound', 'outbound', 'internal']);
export const interactionIntentSchema = z.enum([
  'complaint',
  'praise',
  'question',
  'purchase_intent',
  'cancellation_intent',
  'price_objection',
  'delivery_issue',
  'support',
  'other',
]);
export const interactionUrgencySchema = z.enum(['low', 'medium', 'high']);

export const listInteractionQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  customerId: z.string().uuid().optional(),
  channel: interactionChannelSchema.optional(),
  intent: interactionIntentSchema.optional(),
  urgency: interactionUrgencySchema.optional(),
  productId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const createInteractionSchema = z.object({
  channel: interactionChannelSchema.optional().default('note'),
  direction: interactionDirectionSchema.optional().default('internal'),
  subject: z.string().trim().max(240).nullable().optional(),
  body: z.string().trim().min(1).max(20_000),
  occurredAt: z.coerce.date().optional(),
  customerId: optionalId,
  externalId: z.string().trim().min(1).max(120).nullable().optional(),
  metadata: metadataSchema,
});
