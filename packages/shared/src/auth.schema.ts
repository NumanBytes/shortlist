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

// Account emails (docs/security.md §8.7). Tokens are 32 random bytes, base64url (43 chars).
const OneTimeToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'This link is incomplete — open it from the email again');

export const VerifyEmailSchema = z.object({ token: OneTimeToken }).strict();
export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;

export const ForgotPasswordSchema = z.object({ email: Email }).strict();
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({ token: OneTimeToken, password: NewPassword }).strict();
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
