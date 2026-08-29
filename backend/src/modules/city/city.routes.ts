import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { blockTypes, personas } from './catalog/index.js';
import {
  BlockIdParamsSchema,
  BlockMutationResultSchema,
  BlockTypeSchema,
  CityIdParamsSchema,
  CitySchema,
  CitySummarySchema,
  CreateCityBodySchema,
  ErrorSchema,
  MoveBlockBodySchema,
  PersonaSchema,
  PlaceBlockBodySchema,
  RenameCityBodySchema,
  ReplaceBlocksBodySchema,
  SimulationResultInputSchema,
  SimulationResultSchema,
} from './city.schemas.js';
import * as cityService from './city.service.js';

export default async function cityRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: [app.authenticate] };

  // --- Catalog (public, static) ---
  server.get(
    '/catalog/block-types',
    { schema: { tags: ['catalog'], response: { 200: BlockTypeSchema.array() } } },
    async () => blockTypes,
  );
  server.get(
    '/catalog/personas',
    { schema: { tags: ['catalog'], response: { 200: PersonaSchema.array() } } },
    async () => personas,
  );

  // --- Cities ---
  server.get(
    '/cities',
    {
      ...auth,
      schema: { tags: ['cities'], response: { 200: CitySummarySchema.array(), 401: ErrorSchema } },
    },
    async (request) => cityService.listCities(app.prisma, request.user.sub),
  );

  server.post(
    '/cities',
    {
      ...auth,
      schema: {
        tags: ['cities'],
        body: CreateCityBodySchema,
        response: { 201: CitySchema, 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      const city = await cityService.createCity(app.prisma, request.user.sub, request.body.name);
      return reply.code(201).send(city);
    },
  );

  server.get(
    '/cities/:cityId',
    {
      ...auth,
      schema: {
        tags: ['cities'],
        params: CityIdParamsSchema,
        response: { 200: CitySchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request) => cityService.getCity(app.prisma, request.user.sub, request.params.cityId),
  );

  server.patch(
    '/cities/:cityId',
    {
      ...auth,
      schema: {
        tags: ['cities'],
        params: CityIdParamsSchema,
        body: RenameCityBodySchema,
        response: { 200: CitySchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request) =>
      cityService.renameCity(
        app.prisma,
        request.user.sub,
        request.params.cityId,
        request.body.name,
      ),
  );

  server.delete(
    '/cities/:cityId',
    {
      ...auth,
      schema: {
        tags: ['cities'],
        params: CityIdParamsSchema,
        response: { 204: z.null(), 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      await cityService.deleteCity(app.prisma, request.user.sub, request.params.cityId);
      return reply.code(204).send(null);
    },
  );

  // --- Blocks ---
  server.post(
    '/cities/:cityId/blocks',
    {
      ...auth,
      schema: {
        tags: ['blocks'],
        params: CityIdParamsSchema,
        body: PlaceBlockBodySchema,
        response: {
          201: BlockMutationResultSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await cityService.placeBlock(
        app.prisma,
        request.user.sub,
        request.params.cityId,
        request.body,
      );
      return reply.code(201).send(result);
    },
  );

  server.put(
    '/cities/:cityId/blocks',
    {
      ...auth,
      schema: {
        tags: ['blocks'],
        params: CityIdParamsSchema,
        body: ReplaceBlocksBodySchema,
        response: { 200: CitySchema, 401: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (request) =>
      cityService.replaceBlocks(
        app.prisma,
        request.user.sub,
        request.params.cityId,
        request.body.blocks,
      ),
  );

  server.patch(
    '/cities/:cityId/blocks/:blockId',
    {
      ...auth,
      schema: {
        tags: ['blocks'],
        params: BlockIdParamsSchema,
        body: MoveBlockBodySchema,
        response: {
          200: BlockMutationResultSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request) =>
      cityService.moveBlock(
        app.prisma,
        request.user.sub,
        request.params.cityId,
        request.params.blockId,
        request.body,
      ),
  );

  server.delete(
    '/cities/:cityId/blocks/:blockId',
    {
      ...auth,
      schema: {
        tags: ['blocks'],
        params: BlockIdParamsSchema,
        response: { 200: BlockMutationResultSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request) =>
      cityService.removeBlock(
        app.prisma,
        request.user.sub,
        request.params.cityId,
        request.params.blockId,
      ),
  );

  // --- Simulation storage ---
  server.put(
    '/cities/:cityId/simulation',
    {
      ...auth,
      schema: {
        tags: ['simulation'],
        params: CityIdParamsSchema,
        body: SimulationResultInputSchema,
        response: {
          200: SimulationResultSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request) =>
      cityService.saveSimulationResult(
        app.prisma,
        request.user.sub,
        request.params.cityId,
        request.body,
      ),
  );

  server.get(
    '/cities/:cityId/simulation',
    {
      ...auth,
      schema: {
        tags: ['simulation'],
        params: CityIdParamsSchema,
        response: { 200: SimulationResultSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request) =>
      cityService.getSimulationResult(app.prisma, request.user.sub, request.params.cityId),
  );
}
