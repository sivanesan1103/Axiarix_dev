import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from '../utils/errors.js';

export interface DownloadClaims {
  sub: string; // user id
  kind: 'evidence' | 'report';
  ref: string; // evidence version id or report id
  inline?: boolean;
}

const TTL_SECONDS = 300;

/**
 * Short-lived (5 min), single-purpose signed download tokens. Storage objects are never
 * exposed directly; the API re-checks the user and permissions when the token is redeemed.
 */
export function signDownloadToken(claims: DownloadClaims) {
  return jwt.sign({ ...claims, typ: 'download' }, env.DOWNLOAD_TOKEN_SECRET, { algorithm: 'HS256', expiresIn: TTL_SECONDS, issuer: 'axiarix' });
}

export function verifyDownloadToken(token: string): DownloadClaims {
  try {
    const c = jwt.verify(token, env.DOWNLOAD_TOKEN_SECRET, { algorithms: ['HS256'], issuer: 'axiarix' }) as DownloadClaims & { typ: string };
    if (c.typ !== 'download') throw new Error('wrong type');
    return c;
  } catch {
    throw unauthorized('Download link is invalid or has expired');
  }
}

export const DOWNLOAD_TTL_SECONDS = TTL_SECONDS;
