// Identity resolution for the HTTP layer. There is no real auth system yet
// (Bryan's http.ts PR-description comment block flags this outright: the
// mock hardcodes "vol_amy" and "the real endpoint needs auth context to
// look up the right session row" — this is that auth context, at the
// simplest level that still lets RBAC be genuinely enforced per request).
//
// A caller identifies as a volunteer via the `x-fiscus-volunteer-id`
// header. If it's absent, we default to the data_entry demo volunteer so
// the app has a working out-of-the-box experience; if it's PRESENT but
// doesn't match a known volunteer, that's a real auth failure (401) rather
// than silently falling back — this keeps the 401 path exercisable (e.g.
// by tests) instead of being permanently unreachable.

import type { Request, Response, NextFunction } from 'express';
import type { AccessSubject } from '../../../lib/rbac';
import { getVolunteer, ORG_ID } from './db';

export const DEFAULT_VOLUNTEER_ID = 'vol_amy';

export interface AuthedRequest extends Request {
  volunteer?: AccessSubject;
}

export async function resolveActor(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const headerId = req.header('x-fiscus-volunteer-id');
  const volunteerId = headerId && headerId.trim().length > 0 ? headerId.trim() : DEFAULT_VOLUNTEER_ID;

  try {
    const volunteer = await getVolunteer(volunteerId);
    if (!volunteer) {
      res.status(401).json({ error: 'unauthenticated', detail: `unknown volunteer '${volunteerId}'` });
      return;
    }
    req.volunteer = { volunteerId: volunteer.id, orgId: volunteer.org_id ?? ORG_ID, role: volunteer.role };
    next();
  } catch (err) {
    next(err);
  }
}
