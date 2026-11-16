import { Prisma } from '@prisma/client';
import { AppError } from './errors.js';

/** Runs a write and turns a unique-constraint violation into a readable 409 message. */
export async function prismaUniqueGuard<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new AppError(409, 'CONFLICT', message);
    throw err;
  }
}
