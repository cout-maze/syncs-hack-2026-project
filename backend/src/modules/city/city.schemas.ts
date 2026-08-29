import { z } from 'zod';
import { BLOCK_TYPE_IDS } from '../../config/constants.js';

export const BlockTypeIdSchema = z.enum(BLOCK_TYPE_IDS);

export const BlockTypeSchema = z.object({
  id: BlockTypeIdSchema,
  name: z.string(),
  category: z.string(),
  description: z.string(),
  benefits: z.array(z.string()),
  tradeoffs: z.array(z.string()),
  icon: z.string(),
});

export const ErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type BlockType = z.infer<typeof BlockTypeSchema>;
