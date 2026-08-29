import { z } from 'zod';
import { IsoDateTimeSchema } from './common';

/** specs/auth-service.yaml → User */
export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  createdAt: IsoDateTimeSchema,
});

/** specs/auth-service.yaml → AuthResponse */
export const AuthResponseSchema = z.object({
  token: z.string(),
  user: UserSchema,
});

export const RegisterInputSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  displayName: z.string().min(1, 'Tell us what to call you.').max(40),
});

export const LoginInputSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export type User = z.infer<typeof UserSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type RegisterInput = z.infer<typeof RegisterInputSchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
