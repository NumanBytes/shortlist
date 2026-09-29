import { z } from 'zod';

// Lowercased so "Numan@X.com" and "numan@x.com" can't become two accounts.
const Email = z.string().trim().toLowerCase().email('Invalid email address');

// bcrypt silently ignores everything past 72 BYTES (not characters), so two long
// passwords sharing a 72-byte prefix would both log in. Reject instead of truncating.
const NewPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => new TextEncoder().encode(p).length <= 72, 'Password must be at most 72 bytes');

export const RegisterSchema = z
  .object({
    email: Email,
    password: NewPassword,
    name: z.string().trim().min(1, 'Name is required').max(100),
  })
  .strict();

export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z
  .object({
    email: Email,
    password: z.string().min(1, 'Password is required'),
  })
  .strict();

export type LoginInput = z.infer<typeof LoginSchema>;

export const RefreshSchema = z
  .object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  })
  .strict();

export type RefreshInput = z.infer<typeof RefreshSchema>;
