import { z } from 'zod';
import { schemaToExample } from '../src/modules/advisor/advisor.llm.js';

describe('Advisor Ollama JSON examples', () => {
  it('preserves nested objects and arrays in the generated example', () => {
    const replySchema = z.object({
      metric: z.enum(['accessibility', 'community']),
      affectedGroups: z.array(z.object({ personaId: z.string(), impact: z.string() })),
      suggestion: z.object({ title: z.string(), expectedImpact: z.array(z.string()) }),
      enabled: z.boolean(),
    });

    const example = schemaToExample(z.toJSONSchema(replySchema) as Record<string, unknown>);

    expect(replySchema.safeParse(example).success).toBe(true);
    expect(example.affectedGroups).toEqual([{ personaId: '<personaId>', impact: '<impact>' }]);
    expect(example.suggestion).toEqual({
      title: '<title>',
      expectedImpact: ['<expectedImpact item>'],
    });
  });
});
