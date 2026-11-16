import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { isProduction, isTest } from '../config/env.js';
import { AppError } from '../utils/errors.js';

/** Validates and replaces req.body / req.query with the parsed (coerced, stripped) value. */
export function validate<T extends ZodTypeAny>(schema: T, source: 'body' | 'query' = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(source === 'body' ? req.body : req.query);
    if (!result.success) {
      return next(new AppError(422, 'VALIDATION_FAILED', 'Request validation failed', result.error.flatten()));
    }
    if (source === 'body') req.body = result.data;
    // Express 5 exposes req.query through a getter, so shadow it on the instance.
    else Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
    next();
  };
}

export type Parsed<T extends ZodTypeAny> = z.infer<T>;

export function requestId(req: Request, res: Response, next: NextFunction) {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/** Minimal structured access log (one JSON line per request). */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  if (isTest) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        id: req.requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Math.round(ms),
        user: req.user?.id,
      }),
    );
  });
  next();
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

/** Centralised error translation. Internal details are never leaked in production. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  void _next;
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res
      .status(422)
      .json({ error: { code: 'VALIDATION_FAILED', message: 'Request validation failed', details: err.flatten() } });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the maximum permitted size' : err.message;
    return res.status(413).json({ error: { code: err.code, message } });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002')
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with these values already exists', details: err.meta } });
    if (err.code === 'P2025') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
  }
  const pgMessage = err instanceof Error ? err.message : '';
  if (/cannot be modified|append-only|immutable/.test(pgMessage)) {
    return res.status(409).json({ error: { code: 'IMMUTABLE', message: 'This record is locked and cannot be changed' } });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  console.error(`[error] ${req.requestId}`, err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: isProduction ? 'Unexpected server error' : (err as Error)?.message, requestId: req.requestId },
  });
}
