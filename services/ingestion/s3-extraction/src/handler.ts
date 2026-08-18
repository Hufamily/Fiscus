// Lambda entry point (S3 ObjectCreated trigger). Port of app/handler.py.
// Minimal local event type instead of a full @types/aws-lambda dependency
// — only the two fields actually used are typed.

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { parseDocumentKey } from './key';
import { extractReceipt, redactExtraction, TerminalExtractionError } from './extract';
import { saveExtraction, markNeedsReview } from './repository';
import { IS_MOCK } from './client';
import type { ContentType } from './types';

interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string };
  };
}

export interface S3Event {
  Records: S3EventRecord[];
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function streamToBytes(stream: AsyncIterable<Uint8Array> | undefined): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function handler(event: S3Event): Promise<void> {
  // A deployed Lambda invocation must always have COCKROACH_DATABASE_URL
  // set — IS_MOCK falling back to the local fixture file here would look
  // like success while silently writing nothing to the real database.
  // Mock mode is a CLI-only convenience (see cli.ts).
  if (IS_MOCK) {
    throw new Error('Missing required environment variable: COCKROACH_DATABASE_URL');
  }

  const region = required('AWS_REGION');
  const modelId = required('BEDROCK_MODEL_ID');
  const s3 = new S3Client({ region });

  for (const record of event.Records) {
    const identity = parseDocumentKey(record.s3.object.key);
    try {
      if (modelId === 'DISABLED') {
        throw new TerminalExtractionError('Bedrock extraction is disabled by the Free Tier cost guard');
      }
      const response = await s3.send(new GetObjectCommand({ Bucket: record.s3.bucket.name, Key: identity.s3Key }));
      const contentType = response.ContentType as ContentType;
      const body = await streamToBytes(response.Body as AsyncIterable<Uint8Array> | undefined);
      const extraction = await extractReceipt(region, modelId, body, contentType);
      await saveExtraction(identity, redactExtraction(extraction));
    } catch (err) {
      if (err instanceof TerminalExtractionError) {
        await markNeedsReview(identity, err.message);
      } else {
        throw err;
      }
    }
  }
}
