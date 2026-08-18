// CLI for local testing without a deployed Lambda/S3 — this module has no
// direct Python equivalent; the original had no local/mock mode at all,
// only `python -m unittest test_pipeline.py` against pure functions. This
// exercises the full recordUpload -> extract -> redact -> saveExtraction
// path the same way the real S3-triggered handler does.

import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { IS_MOCK } from './client';
import { documentKey } from './key';
import { extractReceipt, redactExtraction, TerminalExtractionError } from './extract';
import { recordUpload, saveExtraction, markNeedsReview } from './repository';
import { createUpload } from './upload';
import type { ContentType } from './types';

function parseArgs(argv: string[]): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  let i = 0;
  while (i < argv.length) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const values: string[] = [];
      i++;
      while (i < argv.length && !argv[i].startsWith('--')) {
        values.push(argv[i++]);
      }
      result[key] = values.length === 1 ? values[0] : values;
    } else {
      i++;
    }
  }
  return result;
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, ContentType> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

async function runExtract(args: Record<string, string | string[]>, mode: string): Promise<void> {
  const filePath = typeof args['file'] === 'string' ? args['file'] : undefined;
  if (!filePath) {
    console.error("Missing --file <path>.");
    process.exit(1);
    return;
  }
  const orgId = typeof args['org-id'] === 'string' ? args['org-id'] : undefined;
  const volunteerId = typeof args['volunteer-id'] === 'string' ? args['volunteer-id'] : 'cli-system';
  if (!orgId) {
    console.error('Missing --org-id.');
    process.exit(1);
    return;
  }

  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPE_BY_EXTENSION[extension];
  if (!contentType) {
    console.error(`Unsupported file extension: .${extension} (expected pdf, jpg, jpeg, or png)`);
    process.exit(1);
    return;
  }

  const documentId = typeof args['document-id'] === 'string' ? args['document-id'] : randomUUID();
  const s3Key = documentKey(orgId, documentId, extension);
  const identity = { orgId, documentId, s3Key };

  console.log(`${mode} Registering upload for document ${documentId}...`);
  await recordUpload(identity, volunteerId);

  const region = process.env.AWS_REGION ?? 'us-east-1';
  const modelId = process.env.BEDROCK_MODEL_ID ?? 'DISABLED';

  try {
    if (modelId === 'DISABLED') {
      throw new TerminalExtractionError('Bedrock extraction is disabled by the Free Tier cost guard');
    }
    const content = readFileSync(filePath);
    console.log(`${mode} Extracting via Bedrock (${modelId})...`);
    const extraction = await extractReceipt(region, modelId, content, contentType);
    const outcome = await saveExtraction(identity, redactExtraction(extraction));
    console.log(`${mode} Extraction ${outcome} for document ${documentId}.`);
  } catch (err) {
    if (err instanceof TerminalExtractionError) {
      await markNeedsReview(identity, err.message);
      console.log(`${mode} Marked needs_review: ${err.message}`);
    } else {
      throw err;
    }
  }
}

async function runCreateUpload(args: Record<string, string | string[]>, mode: string): Promise<void> {
  const orgId = typeof args['org-id'] === 'string' ? args['org-id'] : undefined;
  const volunteerId = typeof args['volunteer-id'] === 'string' ? args['volunteer-id'] : undefined;
  const contentTypeArg = typeof args['content-type'] === 'string' ? args['content-type'] : undefined;
  const sizeBytesArg = typeof args['size-bytes'] === 'string' ? args['size-bytes'] : undefined;
  if (!orgId || !volunteerId || !contentTypeArg || !sizeBytesArg) {
    console.error('Usage: create-upload --org-id <id> --volunteer-id <id> --content-type <mime> --size-bytes <n>');
    process.exit(1);
    return;
  }
  const bucket = process.env.INGESTION_BUCKET ?? 'fiscus-ingestion-local';
  const region = process.env.AWS_REGION ?? 'us-east-1';

  const result = await createUpload(
    {
      orgId,
      volunteerId,
      contentType: contentTypeArg as ContentType,
      sizeBytes: Number(sizeBytesArg),
    },
    { bucket, region },
  );
  console.log(`${mode} Created upload:`, JSON.stringify(result, null, 2));
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);
  const mode = IS_MOCK ? '[mock mode]' : '[real mode]';

  if (command === 'extract') {
    await runExtract(args, mode);
  } else if (command === 'create-upload') {
    await runCreateUpload(args, mode);
  } else {
    console.error(`Unknown command: ${command ?? '(none)'}. Use 'extract' or 'create-upload'.`);
    process.exit(1);
  }
}

void main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
