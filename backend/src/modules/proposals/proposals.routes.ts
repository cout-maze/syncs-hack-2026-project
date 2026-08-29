import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ErrorSchema,
  ListProposalsQuerySchema,
  ProposalDetailSchema,
  ProposalIdParamsSchema,
  ProposalInputSchema,
  ProposalSchema,
  SetVoteBodySchema,
  VoteStateSchema,
} from './proposals.schemas.js';
import * as proposalsService from './proposals.service.js';

export default async function proposalsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: [app.authenticate] };
  const admin = { preHandler: [app.authenticate, app.requireAdmin] };

  // GET /proposals — public, no auth
  server.get(
    '/proposals',
    {
      schema: {
        tags: ['proposals'],
        querystring: ListProposalsQuerySchema,
        response: { 200: ProposalSchema.array() },
      },
    },
    async (request) => proposalsService.listProposals(app.prisma, request.query.status),
  );

  // POST /proposals — admin only
  server.post(
    '/proposals',
    {
      ...admin,
      schema: {
        tags: ['admin'],
        body: ProposalInputSchema,
        response: { 201: ProposalSchema, 400: ErrorSchema, 401: ErrorSchema, 403: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (request, reply) => {
      const proposal = await proposalsService.createProposal(app.prisma, request.body, request.user.sub);
      return reply.code(201).send(proposal);
    },
  );

  // GET /proposals/:proposalId — optional auth
  server.get(
    '/proposals/:proposalId',
    {
      preHandler: [app.optionalAuthenticate],
      schema: {
        tags: ['proposals'],
        params: ProposalIdParamsSchema,
        response: { 200: ProposalDetailSchema, 404: ErrorSchema },
      },
    },
    async (request) => {
      const userId = request.user?.sub ?? null;
      return proposalsService.getProposalDetail(app.prisma, userId, request.params.proposalId);
    },
  );

  // POST /proposals/:proposalId/close — admin only
  server.post(
    '/proposals/:proposalId/close',
    {
      ...admin,
      schema: {
        tags: ['admin'],
        params: ProposalIdParamsSchema,
        response: { 200: ProposalSchema, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (request) => proposalsService.closeProposal(app.prisma, request.params.proposalId),
  );

  // PUT /proposals/:proposalId/vote — auth required
  server.put(
    '/proposals/:proposalId/vote',
    {
      ...auth,
      schema: {
        tags: ['votes'],
        params: ProposalIdParamsSchema,
        body: SetVoteBodySchema,
        response: { 200: VoteStateSchema, 400: ErrorSchema, 401: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (request) =>
      proposalsService.setVote(app.prisma, request.user.sub, request.params.proposalId, request.body.value),
  );

  // DELETE /proposals/:proposalId/vote — auth required
  server.delete(
    '/proposals/:proposalId/vote',
    {
      ...auth,
      schema: {
        tags: ['votes'],
        params: ProposalIdParamsSchema,
        response: { 200: VoteStateSchema, 401: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (request) =>
      proposalsService.retractVote(app.prisma, request.user.sub, request.params.proposalId),
  );
}
