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
import {
  createCity,
  deleteCity,
  getCity,
  getSimulationResult,
  listCities,
  moveBlock,
  placeBlock,
  removeBlock,
  renameCity,
  replaceBlocks,
  saveSimulationResult,
} from './city.service.js';
import { getCouncilCity } from './council.js';

export default async function cityRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  // --- Catalog (public static data) ------------------------------------------

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

  // --- Cities -----------------------------------------------------------------

  server.get(
    '/cities',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['cities'],
        response: { 200: CitySummarySchema.array(), 401: ErrorSchema },
      },
    },
    async (request) => listCities(app.prisma, request.user.sub),
  );

  server.post(
    '/cities',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['cities'],
        // Body is optional per spec — a body-less POST arrives as `null`, so
        // nullish (not just optional) is what keeps it a 201 and not a 400.
        body: CreateCityBodySchema.nullish(),
        response: { 201: CitySchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      const city = await createCity(app.prisma, request.user.sub, request.body ?? {});
      return reply.code(201).send(city);
    },
  );

  server.get(
    '/cities/council',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['cities'],
        response: { 200: CitySchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async () => getCouncilCity(),
  );

  server.get(
    '/cities/:cityId',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['cities'],
        params: CityIdParamsSchema,
        response: { 200: CitySchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request) => getCity(app.prisma, request.user.sub, request.params.cityId),
  );

  server.patch(
    '/cities/:cityId',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['cities'],
        params: CityIdParamsSchema,
        body: RenameCityBodySchema,
        response: { 200: CitySchema, 400: ErrorSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request) =>
      renameCity(app.prisma, request.user.sub, request.params.cityId, request.body.name),
  );

  server.delete(
    '/cities/:cityId',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['cities'],
        params: CityIdParamsSchema,
        response: { 204: z.undefined(), 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      await deleteCity(app.prisma, request.user.sub, request.params.cityId);
      return reply.code(204).send(undefined);
    },
  );

  // --- Blocks -----------------------------------------------------------------

  server.post(
    '/cities/:cityId/blocks',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['blocks'],
        params: CityIdParamsSchema,
        body: PlaceBlockBodySchema,
        response: {
          201: BlockMutationResultSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await placeBlock(
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
      preHandler: [app.authenticate],
      schema: {
        tags: ['blocks'],
        params: CityIdParamsSchema,
        body: ReplaceBlocksBodySchema,
        response: {
          200: CitySchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request) =>
      replaceBlocks(app.prisma, request.user.sub, request.params.cityId, request.body),
  );

  server.patch(
    '/cities/:cityId/blocks/:blockId',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['blocks'],
        params: BlockIdParamsSchema,
        body: MoveBlockBodySchema,
        response: {
          200: BlockMutationResultSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request) =>
      moveBlock(
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
      preHandler: [app.authenticate],
      schema: {
        tags: ['blocks'],
        params: BlockIdParamsSchema,
        response: { 200: BlockMutationResultSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request) =>
      removeBlock(app.prisma, request.user.sub, request.params.cityId, request.params.blockId),
  );

  // --- Simulation storage -------------------------------------------------------

  server.put(
    '/cities/:cityId/simulation',
    {
      preHandler: [app.authenticate],
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
      saveSimulationResult(app.prisma, request.user.sub, request.params.cityId, request.body),
  );

  server.get(
    '/cities/:cityId/simulation',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['simulation'],
        params: CityIdParamsSchema,
        response: { 200: SimulationResultSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request) => getSimulationResult(app.prisma, request.user.sub, request.params.cityId),
  );
}
