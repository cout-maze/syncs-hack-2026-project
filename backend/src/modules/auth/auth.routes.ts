import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AuthResponseSchema,
  ErrorSchema,
  LoginBodySchema,
  RegisterBodySchema,
  UserSchema,
} from './auth.schemas.js';
import { getUserById, registerUser, verifyCredentials } from './auth.service.js';

export default async function authRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/auth/register',
    {
      schema: {
        tags: ['auth'],
        body: RegisterBodySchema,
        response: { 201: AuthResponseSchema, 409: ErrorSchema },
      },
    },
    async (request, reply) => {
      const user = await registerUser(app.prisma, request.body);
      const token = await app.jwt.sign({ sub: user.id, email: user.email });
      return reply.code(201).send({ token, user });
    },
  );

  server.post(
    '/auth/login',
    {
      schema: {
        tags: ['auth'],
        body: LoginBodySchema,
        response: { 200: AuthResponseSchema, 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      const user = await verifyCredentials(app.prisma, request.body);
      const token = await app.jwt.sign({ sub: user.id, email: user.email });
      return reply.send({ token, user });
    },
  );

  server.get(
    '/auth/me',
    {
      preHandler: [app.authenticate],
      schema: { tags: ['auth'], response: { 200: UserSchema, 401: ErrorSchema } },
    },
    async (request) => getUserById(app.prisma, request.user.sub),
  );
}
