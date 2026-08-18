// Port of the Python app/upload.py. Not wired into template.yaml as its
// own Lambda (the original wasn't either — its README said "use
// create_upload behind an authenticated API route", but no such route
// exists yet). Whoever builds the first real services/api endpoint for
// starting an upload should call createUpload() from there, gated by D1's
// upload_documents capability (lib/rbac.ts) — see services/api/README.md.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { IS_MOCK } from './client';
import { documentKey } from './key';
import { recordUpload } from './repository';
import type { ContentType, CreateUploadRequest, CreateUploadResult } from './types';

const EXTENSION_BY_CONTENT_TYPE: Record<ContentType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const MAX_BYTES = 10_000_000;

export async function createUpload(
  request: CreateUploadRequest,
  opts: { bucket: string; region: string },
): Promise<CreateUploadResult> {
  const extension = EXTENSION_BY_CONTENT_TYPE[request.contentType];
  if (!extension) {
    throw new Error('Unsupported document content type');
  }
  if (!Number.isInteger(request.sizeBytes) || request.sizeBytes < 1 || request.sizeBytes > MAX_BYTES) {
    throw new Error('Document must be between 1 byte and 10 MB');
  }

  const documentId = randomUUID();
  const key = documentKey(request.orgId, documentId, extension);
  await recordUpload({ orgId: request.orgId, documentId, s3Key: key }, request.volunteerId);

  const uploadUrl = IS_MOCK
    ? `mock://local-upload/${opts.bucket}/${key}`
    : await getSignedUrl(
        new S3Client({ region: opts.region }),
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: key,
          ContentType: request.contentType,
          ServerSideEncryption: 'AES256',
        }),
        { expiresIn: 300 },
      );

  return { documentId, key, uploadUrl };
}
