import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ErrorSchema,
  ListProposalsQuerySchema,
  ProposalDetailSchema,
  ProposalIdParamsSchema,
  ProposalInputSchema,
  ProposalSchema,
  SubmitVotesBodySchema,
  SubmitVotesResponseSchema,
  VotingResultsSchema,
} from './proposals.schemas.js';
import * as proposalsService from './proposals.service.js';

export default async function proposalsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: [app.authenticate] };

  server.get(
    '/proposals',
    {
      ...auth,
      schema: {
        tags: ['proposals'],
        querystring: ListProposalsQuerySchema,
        response: { 200: ProposalSchema.array(), 401: ErrorSchema },
      },
    },
    async (request) => proposalsService.listProposals(app.prisma, request.query.status),
  );

  server.post(
    '/proposals',
    {
      ...auth,
      schema: {
        tags: ['admin'],
        body: ProposalInputSchema,
        response: { 201: ProposalSchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await proposalsService.createProposal(app.prisma, request.body)),
  );

  server.get(
    '/proposals/:proposalId',
    {
      ...auth,
      schema: {
        tags: ['proposals'],
        params: ProposalIdParamsSchema,
        response: { 200: ProposalDetailSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request) =>
      proposalsService.getProposalDetail(app.prisma, request.user.sub, request.params.proposalId),
  );

  server.put(
    '/proposals/:proposalId/votes',
    {
      ...auth,
      schema: {
        tags: ['votes'],
        params: ProposalIdParamsSchema,
        body: SubmitVotesBodySchema,
        response: {
          200: SubmitVotesResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request) =>
      proposalsService.submitVotes(
        app.prisma,
        request.user.sub,
        request.params.proposalId,
        request.body.votes,
      ),
  );

  server.get(
    '/proposals/:proposalId/results',
    {
      ...auth,
      schema: {
        tags: ['votes'],
        params: ProposalIdParamsSchema,
        response: { 200: VotingResultsSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request) => proposalsService.getResults(app.prisma, request.params.proposalId),
  );

  server.post(
    '/proposals/:proposalId/close',
    {
      ...auth,
      schema: {
        tags: ['admin'],
        params: ProposalIdParamsSchema,
        response: { 200: ProposalSchema, 401: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (request) => proposalsService.closeProposal(app.prisma, request.params.proposalId),
  );
}
