import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ErrorSchema,
  ExplainProposalBodySchema,
  ProposalExplanationSchema,
} from './advisor.schemas.js';
import { explainProposal } from './advisor.service.js';

export default async function advisorRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: [app.authenticate] };

  server.post(
    '/advisor/proposal-explanation',
    {
      ...auth,
      schema: {
        tags: ['explainer'],
        body: ExplainProposalBodySchema,
        response: {
          200: ProposalExplanationSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          503: ErrorSchema,
        },
      },
    },
    async (request) => explainProposal(app.prisma, request.body.proposalId),
  );
}
