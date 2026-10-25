import { z } from 'zod';
import { badRequest } from './errors.js';

// Parse and validate. On failure, respond 400 with field-level messages.
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw badRequest('Some fields need attention', fields);
  }
  return result.data;
}

export const uuid = z.string().uuid();
export const streams = ['general', 'recyclable', 'organic'];
export const stream = z.enum(streams);

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email')
  .max(254);

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'iloveyou1', 'admin123', 'welcome1', 'bioloop123', 'abc12345',
]);

export const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'That password is too long')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use at least one letter and one number')
  .refine((p) => !COMMON.has(p.toLowerCase()), 'That password is too common');

export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')
  .optional()
  .or(z.literal('').transform(() => undefined));

export const name = z.string().trim().min(2, 'Enter a name').max(80);
