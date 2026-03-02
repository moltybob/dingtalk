import { z } from 'zod';

export const DingTalkConfigSchema = z.object({
  enabled: z.boolean().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  agentId: z.string().optional(), // Required for sending messages
  dmPolicy: z.enum(['open', 'pairing', 'allowlist']).optional(),
  groupPolicy: z.enum(['open', 'allowlist', 'disabled']).optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  webhookUrl: z.string().url().optional(),
  webhookSecret: z.string().min(8).optional(),
  webhookPath: z.string().optional(),
  proxy: z.string().url().optional(),
});