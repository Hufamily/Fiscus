// Per-file embedding pipeline: redact → extract fields → embed → persist → audit.

import path from 'path';
import { readFileSync } from 'fs';
import { z } from 'zod';
import { redact } from '../../../../lib/redact';
import { embed } from '../../../../lib/embeddings';
import { logAction } from '../../../../lib/audit';
import { ExtractionSchema, type ExtractionResult, type TransactionRow } from './types';
import {
  invokeModel, getMockExtraction, insertDocument, insertTransaction,
  IS_MOCK, ORG_ID,
} from './client';

const EXTRACTION_SYSTEM = `You are a financial document field extractor.
Given a redacted financial document, output ONLY valid JSON matching this shape exactly:
{
  "category": "<one of: veterinary, donations, office_supplies, utilities, travel, meals, other>",
  "amount_cents": <integer total amount in cents>,
  "currency": "<ISO code, usually USD>",
  "txn_date": "<YYYY-MM-DD>",
  "extracted_fields": [{"key": "<snake_case>", "value": "<string>"}]
}
No markdown, no explanation — pure JSON only.`;

function extractJson(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fence ? fence[1].trim() : raw.trim();
}

async function extractFields(redactedText: string, docType: string): Promise<ExtractionResult> {
  if (IS_MOCK) return getMockExtraction(docType);

  const userPrompt = `Document type: ${docType}\n\n${redactedText}\n\nExtract the fields.`;
  const raw = await invokeModel(EXTRACTION_SYSTEM, userPrompt);

  const attempt = (text: string) => {
    try {
      return ExtractionSchema.safeParse(JSON.parse(extractJson(text)));
    } catch {
      return { success: false as const, error: { message: 'JSON.parse failed' } };
    }
  };

  const first = attempt(raw);
  if (first.success) return first.data;

  console.error(`[warn] Extraction failed Zod validation: ${JSON.stringify(first.error)}`);
  const correction = `Previous output was invalid. Fix it and output ONLY valid JSON.`;
  const raw2 = await invokeModel(EXTRACTION_SYSTEM, correction);
  const second = attempt(raw2);
  if (second.success) return second.data;
  throw new Error(`Field extraction failed after retry: ${JSON.stringify(second.error)}`);
}

export async function embedFiles(
  filePaths: string[],
  docType: string,
): Promise<TransactionRow[]> {
  const results: TransactionRow[] = [];

  for (const fp of filePaths) {
    const raw = readFileSync(path.resolve(fp), 'utf-8');
    const redacted = redact(raw);

    if (IS_MOCK) {
      console.error(`\n[mock] Redacted text sent to Bedrock for ${path.basename(fp)}:\n${redacted.slice(0, 200)}…\n`);
    }

    const extraction = await extractFields(redacted, docType);
    const embeddingText = `${docType} ${extraction.category} ${extraction.amount_cents} ${extraction.txn_date}`;
    const embedding = await embed(embeddingText);

    const doc = await insertDocument(`local/${path.basename(fp)}`, docType);
    const txn = await insertTransaction(doc.id, extraction, embedding);

    await logAction(ORG_ID, 'cli-system', 'fields_extracted', 'transactions', txn.id, {
      doc_type: docType,
      category: extraction.category,
      amount_cents: extraction.amount_cents,
      s3_key: doc.s3_key,
    });

    results.push(txn);
    console.log(
      `  ✓ ${path.basename(fp)} → txn ${txn.id}  ` +
      `[${extraction.category}  $${(extraction.amount_cents / 100).toFixed(2)}  ${extraction.txn_date}]`,
    );
  }

  return results;
}
