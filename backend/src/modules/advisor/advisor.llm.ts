import Anthropic from '@anthropic-ai/sdk';
import { advisorEnabled, env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export type ToolSchema = Record<string, unknown>;

const anthropicClient =
  advisorEnabled && env.LLM_PROVIDER === 'anthropic'
    ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    : null;

if (!advisorEnabled) {
  logger.warn('No LLM provider configured — Advisor will always return fallback:true responses.');
} else {
  logger.info(`LLM provider: ${env.LLM_PROVIDER}`);
}

async function callAnthropic<T>(opts: {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  toolSchema: ToolSchema;
  parse: (input: unknown) => { success: true; data: T } | { success: false };
}): Promise<T | null> {
  if (!anthropicClient) return null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.ADVISOR_TIMEOUT_MS);
    try {
      const response = await anthropicClient.messages.create(
        {
          model: env.ANTHROPIC_MODEL,
          max_tokens: 1024,
          system: opts.system,
          messages: [{ role: 'user', content: opts.prompt }],
          tools: [
            {
              name: opts.toolName,
              description: opts.toolDescription,
              input_schema: opts.toolSchema as Anthropic.Tool.InputSchema,
            },
          ],
          tool_choice: { type: 'tool', name: opts.toolName },
        },
        { signal: controller.signal },
      );

      const toolUse = response.content.find((block) => block.type === 'tool_use');
      if (!toolUse) {
        logger.warn({ attempt }, 'Anthropic reply had no tool_use block');
        continue;
      }
      const parsed = opts.parse(toolUse.input);
      if (parsed.success) return parsed.data;
      logger.warn({ attempt }, 'Anthropic reply failed schema validation, retrying once');
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, attempt },
        'Anthropic LLM call failed',
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

type JsonSchema = ToolSchema & {
  type?: string;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
};

function exampleValue(schema: JsonSchema, key: string): unknown {
  if (schema.enum?.length) return schema.enum[0];

  const unionMember = schema.anyOf?.find((member) => member.type !== 'null') ?? schema.anyOf?.[0];
  if (unionMember) return exampleValue(unionMember, key);

  if (schema.type === 'object' || schema.properties) {
    const example: Record<string, unknown> = {};
    for (const [property, propertySchema] of Object.entries(schema.properties ?? {})) {
      example[property] = exampleValue(propertySchema, property);
    }
    return example;
  }

  if (schema.type === 'array')
    return schema.items ? [exampleValue(schema.items, `${key} item`)] : [];
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  if (schema.type === 'boolean') return false;
  if (schema.type === 'null') return null;
  return `<${key}>`;
}

export function schemaToExample(schema: ToolSchema): Record<string, unknown> {
  const example = exampleValue(schema as JsonSchema, 'value');
  return typeof example === 'object' && example !== null && !Array.isArray(example)
    ? (example as Record<string, unknown>)
    : {};
}

async function callOllama<T>(opts: {
  system: string;
  prompt: string;
  toolSchema: ToolSchema;
  ollamaExample?: Record<string, unknown>;
  parse: (input: unknown) => { success: true; data: T } | { success: false };
}): Promise<T | null> {
  const example = opts.ollamaExample ?? schemaToExample(opts.toolSchema);
  const requiredKeys = (opts.toolSchema.required as string[] | undefined) ?? Object.keys(example);
  const jsonInstruction = `\n\nYou MUST respond with ONLY a JSON object. Here is an example of the shape:\n${JSON.stringify(example, null, 2)}\n\nRequired keys: ${requiredKeys.join(', ')}. Fill in real values, not placeholders. No markdown fences, no extra text.`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.ADVISOR_TIMEOUT_MS);
    try {
      const response = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: env.OLLAMA_MODEL,
          stream: false,
          format: 'json',
          messages: [
            { role: 'system', content: opts.system + jsonInstruction },
            { role: 'user', content: opts.prompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.warn({ attempt, status: response.status }, 'Ollama HTTP error');
        continue;
      }

      const body = (await response.json()) as { message?: { content?: string } };
      const content = body.message?.content;
      if (!content) {
        logger.warn({ attempt }, 'Ollama reply had no content');
        continue;
      }

      const json = JSON.parse(content);
      const parsed = opts.parse(json);
      if (parsed.success) return parsed.data;
      logger.warn({ attempt }, 'Ollama reply failed schema validation, retrying once');
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, attempt },
        'Ollama LLM call failed',
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

export async function callStructured<T>(opts: {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  toolSchema: ToolSchema;
  ollamaExample?: Record<string, unknown>;
  parse: (input: unknown) => { success: true; data: T } | { success: false };
}): Promise<T | null> {
  if (!advisorEnabled) return null;

  if (env.LLM_PROVIDER === 'ollama') {
    return callOllama({ ...opts, ollamaExample: opts.ollamaExample });
  }
  return callAnthropic(opts);
}
