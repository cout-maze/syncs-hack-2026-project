import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../lib/errors.js';
import {
  ErrorSchema,
  LegacyProposalInputSchema,
  ListProposalsQuerySchema,
  ProposalDetailSchema,
  ProposalIdParamsSchema,
  ProposalInputSchema,
  ProposalSchema,
  SetVoteBodySchema,
  SubmitVotesBodySchema,
  SubmitVotesResponseSchema,
  VoteStateSchema,
  VotingResultsSchema,
} from './proposals.schemas.js';
import * as proposalsService from './proposals.service.js';

export default async function proposalsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: [app.authenticate] };
  const optionalAuth = { preHandler: [app.optionalAuthenticate] };
  const admin = { preHandler: [app.authenticate, app.requireAdmin] };

  server.get(
    '/proposals',
    {
      ...optionalAuth,
      schema: {
        tags: ['proposals'],
        querystring: ListProposalsQuerySchema,
        response: { 200: ProposalSchema.array() },
      },
    },
    async (request) => proposalsService.listProposals(app.prisma, request.query.status),
  );

  server.post(
    '/proposals',
    {
      ...auth,
      schema: {
        tags: ['proposals'],
        body: ProposalInputSchema,
        response: {
          201: ProposalSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const parsedLegacy = LegacyProposalInputSchema.safeParse(request.body);
      if (parsedLegacy.success && request.user.role !== 'admin') {
        throw AppError.forbidden('Requires role admin.', 'FORBIDDEN');
      }
      return reply
        .code(201)
        .send(await proposalsService.createProposal(app.prisma, request.body, request.user.sub));
    },
  );

  server.get(
    '/proposals/:proposalId',
    {
      ...optionalAuth,
      schema: {
        tags: ['proposals'],
        params: ProposalIdParamsSchema,
        response: { 200: ProposalDetailSchema, 404: ErrorSchema },
      },
    },
    async (request) =>
      proposalsService.getProposalDetail(
        app.prisma,
        request.user?.sub ?? null,
        request.params.proposalId,
      ),
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

  // Compatibility endpoints for the original single up/down client.
  server.put(
    '/proposals/:proposalId/vote',
    {
      ...auth,
      schema: {
        tags: ['votes'],
        params: ProposalIdParamsSchema,
        body: SetVoteBodySchema,
        response: {
          200: VoteStateSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request) =>
      proposalsService.setLegacyVote(
        app.prisma,
        request.user.sub,
        request.params.proposalId,
        request.body.value,
      ),
  );

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
      proposalsService.retractLegacyVote(app.prisma, request.user.sub, request.params.proposalId),
  );

  server.post(
    '/proposals/:proposalId/close',
    {
      ...admin,
      schema: {
        tags: ['admin'],
        params: ProposalIdParamsSchema,
        response: {
          200: ProposalSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request) => proposalsService.closeProposal(app.prisma, request.params.proposalId),
  );
}
