import { z } from 'zod';

/** Mirrors the backend password policy so users see errors before submitting. */
export const passwordSchema = z
  .string()
  .min(12, 'At least 12 characters')
  .regex(/[A-Z]/, 'Include an upper-case letter')
  .regex(/[a-z]/, 'Include a lower-case letter')
  .regex(/[0-9]/, 'Include a digit');

export const requiredText = (label: string, min = 1, max = 2000) =>
  z
    .string()
    .trim()
    .min(min, min > 1 ? `${label} needs at least ${min} characters` : `${label} is required`)
    .max(max);

export const optionalText = (max = 4000) => z.string().trim().max(max).optional().or(z.literal(''));

export const dateString = (label: string) => z.string().min(1, `${label} is required`);
