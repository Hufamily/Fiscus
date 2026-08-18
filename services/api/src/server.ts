// Minimal Express server exposing the FiscusApi contract
// (services/web/src/api/client.ts) over HTTP, per issue #26.

import express, { type Request, type Response, type NextFunction } from 'express';
import { router } from './routes';
import { AccessDeniedError } from '../../../lib/rbac';

export function createApp() {
  const app = express();
  app.use(express.json());

  // Hackathon-simple CORS: the frontend (Vercel) and this server are on
  // different origins, and there's no cookie-based auth to protect (identity
  // travels via the x-fiscus-volunteer-id header, not a cookie), so an
  // open allow-origin is an acceptable trade-off for the demo window.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-fiscus-volunteer-id');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.use('/api', router);

  // Fallback error handler: AccessDeniedError should already be caught at
  // the point it's thrown (requireCapability / the inline enforceAccess
  // call in the corrections route both translate it to a 403 themselves),
  // this only exists as a belt-and-suspenders net plus the catch-all for
  // anything else (never leak stack traces / raw error messages that might
  // echo unredacted request data).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AccessDeniedError) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[services/api] unhandled error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
