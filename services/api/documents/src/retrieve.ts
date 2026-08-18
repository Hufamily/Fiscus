// retrieveDocumentUrl(): enforce RBAC -> look up document -> presign a
// short-TTL S3 GET -> audit. This is the A4 module's one entry point;
// issue #26 (the real Express server) wraps it in an HTTP handler later.

import { logAction } from '../../../../lib/audit';
import { enforceAccess, type AccessSubject } from '../../../../lib/rbac';
import { IS_MOCK, TTL_SECONDS, getDocument, presignGetUrl } from './client';
import type { RetrieveDocumentResult } from './types';

export interface RetrieveOpts {
  bucket: string;
  region: string;
  // Injectable clock so tests can assert TTL/expiry math without waiting
  // 5 real minutes (and so mock-mode "expired URL" behavior is testable).
  now?: () => Date;
}

export async function retrieveDocumentUrl(
  subject: AccessSubject,
  documentId: string,
  opts: RetrieveOpts,
): Promise<RetrieveDocumentResult> {
  // 0. A4 / D1 enforcement — only reviewer/treasurer hold view_raw_document;
  // a denied attempt is audit-logged by enforceAccess before it throws.
  await enforceAccess(subject, {
    capability: 'view_raw_document',
    targetTable: 'documents',
    targetId: documentId,
  });

  // 1. Look up the document within the caller's org (never cross-org).
  const doc = await getDocument(documentId, subject.orgId);
  if (!doc) {
    throw new Error(`Document not found: ${documentId}`);
  }

  // 2. Pre-signed, short-TTL S3 URL — 5 minutes, never a long-lived public
  // link (A4 spec). `now` defaults to the wall clock; tests inject a fixed
  // instant to check the expiry math deterministically.
  const issuedAt = (opts.now ?? (() => new Date()))();
  const expiresAt = new Date(issuedAt.getTime() + TTL_SECONDS * 1000);
  const url = await presignGetUrl(doc.s3_key, {
    bucket: opts.bucket,
    region: opts.region,
    ttlSeconds: TTL_SECONDS,
    issuedAt,
  });

  // 3. Audit — every URL generation call logs view_raw_document (A4
  // acceptance criteria), regardless of mock/real mode.
  await logAction(subject.orgId, subject.volunteerId, 'view_raw_document', 'documents', documentId, {
    s3Key: doc.s3_key,
    expiresAt: expiresAt.toISOString(),
    mock: IS_MOCK,
  });

  return {
    documentId,
    url,
    expiresAt: expiresAt.toISOString(),
    ttlSeconds: TTL_SECONDS,
  };
}

// Pure helper: has a previously-issued URL's TTL elapsed as of `at`
// (defaults to now)? Real S3 enforces this itself (a presigned GET 403s
// past its Expires param); this lets mock mode — and tests — assert the
// same "expires and 403s after TTL" acceptance criterion without a real
// S3 round trip or a literal 5-minute wait.
export function isExpired(result: Pick<RetrieveDocumentResult, 'expiresAt'>, at: Date = new Date()): boolean {
  return at.getTime() >= new Date(result.expiresAt).getTime();
}
