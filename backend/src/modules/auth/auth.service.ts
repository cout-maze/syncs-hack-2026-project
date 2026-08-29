import { hash, verify } from '@node-rs/argon2';
import type { prisma as PrismaClient } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { generateId, IdPrefix } from '../../lib/ids.js';
import type { User } from './auth.schemas.js';

type Prisma = typeof PrismaClient;

function toPublicUser(user: {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: Date;
}): User {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function registerUser(
  prisma: Prisma,
  input: { email: string; password: string; displayName: string },
) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
  }

  const passwordHash = await hash(input.password);
  const user = await prisma.user.create({
    data: {
      id: generateId(IdPrefix.user),
      email: input.email,
      passwordHash,
      displayName: input.displayName,
    },
  });

  return toPublicUser(user);
}

export async function verifyCredentials(
  prisma: Prisma,
  input: { email: string; password: string },
) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Same error for a missing account and a wrong password — never leak which one it was.
  if (!user || !(await verify(user.passwordHash, input.password))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  return toPublicUser(user);
}

export async function getUserById(prisma: Prisma, id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw AppError.unauthorized();
  return toPublicUser(user);
}
