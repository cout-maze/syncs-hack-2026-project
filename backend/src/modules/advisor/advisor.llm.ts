import Anthropic from '@anthropic-ai/sdk';
import { advisorEnabled, env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export const client = advisorEnabled ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

export async function callStructured<T>(opts: {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  toolSchema: Anthropic.Tool.InputSchema;
  parse: (input: unknown) => { success: true; data: T } | { success: false };
}): Promise<T | null> {
  if (!client) return null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.ADVISOR_TIMEOUT_MS);
    try {
      const response = await client.messages.create(
        {
          model: env.ANTHROPIC_MODEL,
          max_tokens: 1024,
          system: opts.system,
          messages: [{ role: 'user', content: opts.prompt }],
          tools: [
            {
              name: opts.toolName,
              description: opts.toolDescription,
              input_schema: opts.toolSchema,
            },
          ],
          tool_choice: { type: 'tool', name: opts.toolName },
        },
        { signal: controller.signal },
      );

      const toolUse = response.content.find((block) => block.type === 'tool_use');
      if (!toolUse) {
        logger.warn({ attempt }, 'LLM reply had no tool_use block');
        continue;
      }
      const parsed = opts.parse(toolUse.input);
      if (parsed.success) return parsed.data;
      logger.warn({ attempt }, 'LLM reply failed schema validation, retrying once');
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, attempt },
        'LLM call failed',
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
