import { describe, it, expect } from 'vitest';
import { documentKey, parseDocumentKey } from '../services/ingestion/s3-extraction/src/key';
import { validateExtraction, redactExtraction, TerminalExtractionError } from '../services/ingestion/s3-extraction/src/extract';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';
const DOCUMENT_ID = '223e4567-e89b-42d3-a456-426614174000';

describe('key — tenant-scoped original key', () => {
  it('round-trips org/document ids through the S3 key shape', () => {
    const key = documentKey(ORG_ID, DOCUMENT_ID, 'pdf');
    expect(key).toBe(`${ORG_ID}/${DOCUMENT_ID}/original.pdf`);
    expect(parseDocumentKey(key).documentId).toBe(DOCUMENT_ID);
  });

  it('rejects a key that does not match the original.{ext} shape', () => {
    expect(() => parseDocumentKey(`${ORG_ID}/${DOCUMENT_ID}/receipt.pdf`)).toThrow();
  });
});

describe('extract — schema validation', () => {
  it('accepts a well-formed extraction and uppercases currency', () => {
    const result = validateExtraction(JSON.stringify({
      vendor: 'Community Market',
      transactionDate: '2026-08-18',
      amountCents: 1250,
      currency: 'usd',
      lineItems: [{ description: 'Food', amountCents: 1250 }],
    }));
    expect(result.currency).toBe('USD');
  });

  it('rejects an extraction missing required fields', () => {
    expect(() => validateExtraction('{"vendor":"invalid"}')).toThrow(TerminalExtractionError);
  });
});

describe('extract — redaction happens before persistence', () => {
  it('redacts card numbers out of vendor and line item descriptions', () => {
    const result = redactExtraction({
      vendor: 'Card 4111 1111 1111 1111',
      transactionDate: '2026-08-18',
      amountCents: 1250,
      currency: 'USD',
      lineItems: [{ description: 'Payment 4111111111111111', amountCents: 1250 }],
    });
    expect(result.vendor).not.toContain('4111 1111 1111 1111');
    expect(result.lineItems[0].description).not.toContain('4111111111111111');
  });
});
