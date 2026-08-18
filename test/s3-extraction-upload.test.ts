// Integration tests for upload.ts's createUpload(). Mocks client.ts
// (IS_MOCK) and repository.ts (recordUpload) so this never touches the real
// checked-in fixtures/mock-db.json or calls out to AWS S3 — mirrors the
// vi.mock('.../client') pattern in test/agent.test.ts and
// test/template-gen.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/ingestion/s3-extraction/src/client', () => ({
  IS_MOCK: true,
}));

const { recordUpload } = vi.hoisted(() => ({ recordUpload: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/ingestion/s3-extraction/src/repository', () => ({ recordUpload }));

import { createUpload } from '../services/ingestion/s3-extraction/src/upload';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';

beforeEach(() => {
  recordUpload.mockClear();
});

describe('createUpload() — mock mode', () => {
  it('returns a mock:// upload URL keyed by org/document/original.ext and registers it', async () => {
    const result = await createUpload(
      { orgId: ORG_ID, volunteerId: 'vol-1', contentType: 'application/pdf', sizeBytes: 1024 },
      { bucket: 'fiscus-docs', region: 'us-east-1' },
    );

    expect(result.key).toBe(`${ORG_ID}/${result.documentId}/original.pdf`);
    expect(result.uploadUrl).toBe(`mock://local-upload/fiscus-docs/${result.key}`);
    expect(recordUpload).toHaveBeenCalledWith(
      { orgId: ORG_ID, documentId: result.documentId, s3Key: result.key },
      'vol-1',
    );
  });

  it('maps image/png and image/jpeg to the right extension', async () => {
    const png = await createUpload(
      { orgId: ORG_ID, volunteerId: 'vol-1', contentType: 'image/png', sizeBytes: 1024 },
      { bucket: 'b', region: 'us-east-1' },
    );
    expect(png.key.endsWith('.png')).toBe(true);

    const jpeg = await createUpload(
      { orgId: ORG_ID, volunteerId: 'vol-1', contentType: 'image/jpeg', sizeBytes: 1024 },
      { bucket: 'b', region: 'us-east-1' },
    );
    expect(jpeg.key.endsWith('.jpg')).toBe(true);
  });

  it('rejects a size of 0 bytes', async () => {
    await expect(
      createUpload({ orgId: ORG_ID, volunteerId: 'vol-1', contentType: 'application/pdf', sizeBytes: 0 }, { bucket: 'b', region: 'us-east-1' }),
    ).rejects.toThrow(/between 1 byte and 10 MB/);
    expect(recordUpload).not.toHaveBeenCalled();
  });

  it('rejects a size over the 10 MB cap', async () => {
    await expect(
      createUpload({ orgId: ORG_ID, volunteerId: 'vol-1', contentType: 'application/pdf', sizeBytes: 10_000_001 }, { bucket: 'b', region: 'us-east-1' }),
    ).rejects.toThrow(/between 1 byte and 10 MB/);
    expect(recordUpload).not.toHaveBeenCalled();
  });

  it('rejects an unsupported content type', async () => {
    await expect(
      createUpload({ orgId: ORG_ID, volunteerId: 'vol-1', contentType: 'text/plain' as any, sizeBytes: 1024 }, { bucket: 'b', region: 'us-east-1' }),
    ).rejects.toThrow(/Unsupported document content type/);
    expect(recordUpload).not.toHaveBeenCalled();
  });
});
