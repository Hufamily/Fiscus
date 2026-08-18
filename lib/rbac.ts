// Server-side RBAC enforcement — AGENTS.md §5.3 (D1: "RBAC is enforced at
// the query layer, not just hidden in the UI").
//
// This mirrors the capability matrix already live in
// services/web/src/lib/rbac.ts, whose own header says the UI copy is
// decorative and "the real enforcement lives in services/api / D1". There is
// no shared package boundary between the root lib/ (Node) and services/web
// (browser bundle), so this is a deliberate, documented duplication of that
// matrix — if it changes, update both files in the same PR (see
// docs/security.md).
//
// This is the application-layer "second line of defense" called for in
// issue D1; see docs/security.md for why CockroachDB-native row-level
// security is not also wired in yet.

import { logAction } from './audit';

export type VolunteerRole = 'data_entry' | 'reviewer' | 'treasurer' | 'leadership';

export type Capability =
  | 'upload_documents'
  | 'review_extractions'
  | 'apply_corrections'
  | 'approve_templates'
  | 'view_row_level_transactions'
  | 'view_aggregate_reports';

const MATRIX: Record<VolunteerRole, ReadonlySet<Capability>> = {
  data_entry: new Set(['upload_documents', 'review_extractions', 'apply_corrections', 'view_row_level_transactions']),
  reviewer: new Set(['review_extractions', 'apply_corrections', 'approve_templates', 'view_row_level_transactions']),
  treasurer: new Set(['review_extractions', 'approve_templates', 'view_row_level_transactions', 'view_aggregate_reports']),
  leadership: new Set(['view_aggregate_reports']),
};

// Capabilities where a data_entry volunteer is further restricted to
// resources they themselves uploaded (D1 spec: "data_entry → write-own-
// uploads only"). Other roles are not owner-scoped.
const OWN_UPLOADS_ONLY: ReadonlySet<Capability> = new Set(['upload_documents', 'apply_corrections']);

export function can(role: VolunteerRole, cap: Capability): boolean {
  return MATRIX[role].has(cap);
}

export interface AccessSubject {
  volunteerId: string;
  orgId: string;
  role: VolunteerRole;
}

export interface AccessRequest {
  capability: Capability;
  targetTable: string; // for the audit_log row on denial
  targetId: string;
  uploadedBy?: string; // documents.uploaded_by, when the target is a document
}

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

export function isAllowed(subject: AccessSubject, request: AccessRequest): boolean {
  if (!can(subject.role, request.capability)) return false;
  if (subject.role === 'data_entry' && OWN_UPLOADS_ONLY.has(request.capability)) {
    // Fail closed: an unknown owner is treated as not-yours.
    return request.uploadedBy === subject.volunteerId;
  }
  return true;
}

// Enforces access and, on denial, writes the audit_log entry before
// throwing — denied attempts must themselves be audit-logged (D1 acceptance
// criteria), not just rejected.
export async function enforceAccess(subject: AccessSubject, request: AccessRequest): Promise<void> {
  if (isAllowed(subject, request)) return;

  await logAction(subject.orgId, subject.volunteerId, 'access_denied', request.targetTable, request.targetId, {
    role: subject.role,
    capability: request.capability,
  });

  throw new AccessDeniedError(
    `role '${subject.role}' lacks capability '${request.capability}' on ${request.targetTable}:${request.targetId}`,
  );
}

// Framework-agnostic middleware factory. services/api has no HTTP framework
// chosen yet (see services/api/README.md), so this matches the (req, res,
// next) shape common to Express/Connect — wire it to whichever router lands
// there instead of duplicating the access check per handler.
export interface RbacRequest {
  volunteer?: AccessSubject;
}

export interface RbacResponse {
  status(code: number): RbacResponse;
  json(body: unknown): void;
}

export type NextFn = (err?: unknown) => void;

export function requireCapability<Req extends RbacRequest>(
  toRequest: (req: Req) => AccessRequest,
) {
  return async (req: Req, res: RbacResponse, next: NextFn): Promise<void> => {
    if (!req.volunteer) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    try {
      await enforceAccess(req.volunteer, toRequest(req));
      next();
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      next(err);
    }
  };
}
