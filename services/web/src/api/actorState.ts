// Bridges the demo role switcher (services/web/src/lib/session.tsx) to the
// real HTTP client (http.ts), which has no React context available at
// module scope. Mirrors fallbackState.ts's tiny pub/sub-free "just a
// module-level variable" pattern — there's exactly one reader (http.ts,
// read fresh on every request) so no subscription is needed.
//
// Without this, every request from createHttpApi() would carry no identity
// at all and services/api's requireCapability() middleware would 401
// everything — the real API literally does not work end-to-end without the
// UI telling it who's asking. See services/web/src/lib/rbac.ts's own header:
// "the real enforcement lives in services/api / D1" — this is the wire that
// makes that enforcement receive a real actor instead of nothing.
import type { Role } from "../types";

// Demo-only identity mapping (mirrors src/mock/data.ts's VOLUNTEERS ids and
// src/lib/session.tsx's DEMO_NAMES). A real deployment would replace this
// entire module with actual auth (session cookie / JWT), not a role->id map.
const VOLUNTEER_ID_BY_ROLE: Record<Role, string> = {
  data_entry: "vol_amy",
  reviewer: "vol_raj",
  treasurer: "vol_dana",
  leadership: "vol_pat",
};

let _currentRole: Role = "data_entry";

export function setActorRole(role: Role): void {
  _currentRole = role;
}

export function currentVolunteerId(): string {
  return VOLUNTEER_ID_BY_ROLE[_currentRole];
}
