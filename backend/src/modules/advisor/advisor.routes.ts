import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AdvisorReportSchema,
  AnalyseCityBodySchema,
  ErrorSchema,
  ExplainProposalBodySchema,
  ProposalExplanationSchema,
} from './advisor.schemas.js';
import { analyseCity, explainProposal } from './advisor.service.js';

export default async function advisorRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: [app.authenticate] };

  server.post(
    '/advisor/analysis',
    {
      ...auth,
      schema: {
        tags: ['advisor'],
        body: AnalyseCityBodySchema,
        response: {
          200: AdvisorReportSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          503: ErrorSchema,
        },
      },
    },
    async (request) => analyseCity(request.body.city, request.body.simulation, request.body.focus),
  );

  server.post(
    '/advisor/proposal-explanation',
    {
      ...auth,
      schema: {
        tags: ['advisor'],
        body: ExplainProposalBodySchema,
        response: {
          200: ProposalExplanationSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          503: ErrorSchema,
        },
      },
    },
    async (request) =>
      explainProposal(app.prisma, request.body.proposalId, request.body.votingResults),
  );
}
