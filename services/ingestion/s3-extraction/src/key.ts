// Direct port of the Python app/key.py (see git history on
// origin/track/a/a2-ingestion-rebase-fix) — same UUID-pair key shape,
// same validation, no behavior change.

import type { DocumentIdentity } from './types';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const KEY_PATTERN = new RegExp(`^(${UUID})/(${UUID})/original\\.(pdf|png|jpe?g)$`, 'i');

const EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg']);

export function parseDocumentKey(key: string): DocumentIdentity {
  const decoded = decodeURIComponent(key.replace(/\+/g, ' '));
  const match = KEY_PATTERN.exec(decoded);
  if (!match) {
    throw new Error('S3 key must match {org_id}/{document_id}/original.{ext}');
  }
  return { orgId: match[1], documentId: match[2], s3Key: decoded };
}

export function documentKey(orgId: string, documentId: string, extension: string): string {
  const normalized = extension.toLowerCase().replace(/^\./, '');
  if (!EXTENSIONS.has(normalized)) {
    throw new Error('Only PDF, PNG, JPG, and JPEG uploads are supported');
  }
  return `${orgId}/${documentId}/original.${normalized}`;
}
