import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '../types/auth.js';

/**
 * Real-time updates over Server-Sent Events.
 *
 * Every signed-in browser keeps one stream open (`GET /api/v1/events`). When a change is saved, the
 * server sends a small message naming the area that changed (e.g. `assessments`) — never the record's
 * data. Each browser then re-reads the affected screens through the normal API, which applies the
 * user's permissions and scope. Personal events (a new notification, a change to your own access) go
 * only to that user.
 *
 * The hub is in memory, which suits a single API instance (the pilot). Several instances would need a
 * shared channel such as PostgreSQL LISTEN/NOTIFY or Redis.
 */
type Client = { user: AuthUser; res: Response };
const clients = new Set<Client>();

export type RealtimeEvent =
  | { type: 'change'; resource: string; id?: string | null; actorId?: string | null }
  | { type: 'notification' }
  | { type: 'profile' };

function send(c: Client, event: RealtimeEvent) {
  c.res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Opens the event stream for the signed-in user. */
export function subscribe(req: Request, res: Response) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tell nginx not to buffer
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const client: Client = { user: req.user!, res };
  clients.add(client);
  send(client, { type: 'change', resource: 'connected' });
  // Comments keep proxies from closing an idle connection.
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

/** Tells everyone in the organisation that an area changed. */
export function publishChange(organisationId: string, event: Omit<Extract<RealtimeEvent, { type: 'change' }>, 'type'>) {
  for (const c of clients) if (c.user.organisationId === organisationId) send(c, { type: 'change', ...event });
}

/** Sends a personal event to one user's open browsers. */
export function publishToUser(userId: string, event: RealtimeEvent) {
  for (const c of clients) if (c.user.id === userId) send(c, event);
}

/** Closes a user's streams (deactivation, sign-out everywhere). */
export function disconnectUser(userId: string) {
  for (const c of clients) if (c.user.id === userId) c.res.end();
}

export const connectedClients = () => clients.size;

const SKIP = new Set(['auth', 'events', 'notifications', 'search', 'health']);

/**
 * After every successful change (POST/PUT/PATCH/DELETE answered with 2xx), announce which area changed.
 * Runs on `finish`, i.e. after the transaction has committed and the response was sent, so browsers
 * that re-read straight away see the new data.
 */
export function announceChanges(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    const user = req.user;
    if (!user || res.statusCode >= 300) return;
    const [resource, id] = req.originalUrl.split('?')[0].replace(/^\/api\/v1\//, '').split('/');
    if (!resource || SKIP.has(resource)) return;
    publishChange(user.organisationId, { resource, id: id ?? null, actorId: user.id });
    // A change to someone's account, roles or restrictions: their own browser re-reads their profile.
    if (resource === 'users' && id && id !== 'directory') publishToUser(id, { type: 'profile' });
  });
  next();
}
