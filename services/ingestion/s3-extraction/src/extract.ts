// Port of the Python app/bedrock.py + app/redaction.py, minus the
// redaction reimplementation: redactExtraction() below calls the shared
// lib/redact.ts instead of a second Luhn-check implementation, so there's
// exactly one place PII/PCI redaction logic lives in this repo (AGENTS.md
// §5.1).

import { redact } from '../../../../lib/redact';
import { converse, type ConverseBlock } from './client';
import type { ContentType, ExtractionResult, LineItem } from './types';

export class TerminalExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalExtractionError';
  }
}

const INSTRUCTION = `Extract this financial document. Return JSON only with this shape:
{"vendor":"string","transactionDate":"YYYY-MM-DD","amountCents":123,"currency":"USD","lineItems":[{"description":"string","quantity":1,"amountCents":123}],"category":"string"}.
Use integer cents. Do not include card numbers or raw document text.`;

export async function extractReceipt(
  region: string,
  modelId: string,
  content: Uint8Array,
  contentType: ContentType,
): Promise<ExtractionResult> {
  let blocks: ConverseBlock[];
  if (contentType === 'application/pdf') {
    blocks = [{ document: { format: 'pdf', name: 'financial-document', source: { bytes: content } } }, { text: INSTRUCTION }];
  } else if (contentType === 'image/jpeg' || contentType === 'image/png') {
    blocks = [{ image: { format: contentType === 'image/png' ? 'png' : 'jpeg', source: { bytes: content } } }, { text: INSTRUCTION }];
  } else {
    throw new TerminalExtractionError('Unsupported uploaded document type');
  }

  const text = await converse(region, modelId, blocks);
  return validateExtraction(text);
}

export function validateExtraction(text: string): ExtractionResult {
  let value: unknown;
  try {
    value = JSON.parse(text.trim().replace(/^```json/, '').replace(/```$/, '').trim());
  } catch {
    throw new TerminalExtractionError('Bedrock response was not valid JSON');
  }

  if (typeof value !== 'object' || value === null) {
    throw new TerminalExtractionError('Bedrock extraction did not meet the receipt schema');
  }
  const v = value as Record<string, unknown>;

  const required = ['vendor', 'transactionDate', 'amountCents', 'currency', 'lineItems'];
  for (const field of required) {
    if (!(field in v)) throw new TerminalExtractionError('Bedrock extraction did not meet the receipt schema');
  }
  if (typeof v.vendor !== 'string' || typeof v.currency !== 'string' || !Number.isInteger(v.amountCents)) {
    throw new TerminalExtractionError('Bedrock extraction did not meet the receipt schema');
  }
  if (typeof v.transactionDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.transactionDate) || !Array.isArray(v.lineItems)) {
    throw new TerminalExtractionError('Bedrock extraction did not meet the receipt schema');
  }
  for (const item of v.lineItems) {
    if (typeof item !== 'object' || item === null || typeof (item as LineItem).description !== 'string' || !Number.isInteger((item as LineItem).amountCents)) {
      throw new TerminalExtractionError('Bedrock returned an invalid line item');
    }
  }

  return {
    vendor: v.vendor,
    transactionDate: v.transactionDate,
    amountCents: v.amountCents as number,
    currency: v.currency.toUpperCase(),
    lineItems: v.lineItems as LineItem[],
    category: typeof v.category === 'string' ? v.category : undefined,
  };
}

// Belt-and-suspenders redaction: the model is instructed not to echo card
// numbers, but this runs unconditionally before anything is persisted
// (AGENTS.md §5.1) rather than trusting the instruction alone.
export function redactExtraction(extraction: ExtractionResult): ExtractionResult {
  return {
    ...extraction,
    vendor: redact(extraction.vendor),
    category: extraction.category !== undefined ? redact(extraction.category) : undefined,
    lineItems: extraction.lineItems.map((item) => ({ ...item, description: redact(item.description) })),
  };
}
