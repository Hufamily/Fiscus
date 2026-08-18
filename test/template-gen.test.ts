import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logAction } = vi.hoisted(() => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/audit', () => ({ logAction }));

const { insertTemplate, invokeModel } = vi.hoisted(() => ({
  insertTemplate: vi.fn().mockImplementation(async (formType: string, schemaJson: unknown, embedding: number[]) => ({
    id: 'tpl-1',
    org_id: 'org-1',
    form_type: formType,
    schema_json: schemaJson,
    embedding,
    status: 'pending_review',
    created_at: new Date().toISOString(),
  })),
  invokeModel: vi.fn(),
}));
vi.mock('../services/ingestion/template-gen/src/client', () => ({
  IS_MOCK: true,
  ORG_ID: 'org-1',
  invokeModel,
  insertTemplate,
  getTemplate: vi.fn(),
  setTemplateApproved: vi.fn(),
}));

import { generateTemplate } from '../services/ingestion/template-gen/src/generate';
import { approveTemplate } from '../services/ingestion/template-gen/src/approve';
import * as client from '../services/ingestion/template-gen/src/client';

const mockGetTemplate = client.getTemplate as ReturnType<typeof vi.fn>;
const mockSetTemplateApproved = client.setTemplateApproved as ReturnType<typeof vi.fn>;

const VALID_SCHEMA = JSON.stringify([
  { key: 'invoice_number', label: 'Invoice Number', type: 'string', sample: 'INV-240715' },
  { key: 'invoice_date', label: 'Invoice Date', type: 'date', sample: '07/15/2024' },
  { key: 'total_amount', label: 'Total Amount', type: 'amount', sample: '$244.69' },
  { key: 'vendor_name', label: 'Vendor Name', type: 'string', sample: 'Paws & Claws Veterinary Clinic' },
]);

const FIXTURE_FILES = [
  'services/ingestion/template-gen/fixtures/vet_invoice_1.txt',
  'services/ingestion/template-gen/fixtures/vet_invoice_2.txt',
];

beforeEach(() => {
  logAction.mockClear();
  insertTemplate.mockClear();
  invokeModel.mockReset();
  mockGetTemplate.mockReset();
  mockSetTemplateApproved.mockReset();
});

describe('generateTemplate() — redact -> Bedrock -> Zod validate -> embed -> persist (B2)', () => {
  it('requires at least 2 example files', async () => {
    await expect(generateTemplate('vet_invoice', ['only_one.txt'])).rejects.toThrow(/at least 2/);
  });

  it('persists a schema on valid first-attempt Bedrock JSON, and audits it', async () => {
    invokeModel.mockResolvedValueOnce(VALID_SCHEMA);

    const template = await generateTemplate('vet_invoice', FIXTURE_FILES);

    expect(invokeModel).toHaveBeenCalledTimes(1);
    expect(template.form_type).toBe('vet_invoice');
    expect(insertTemplate).toHaveBeenCalledWith('vet_invoice', expect.any(Array), expect.any(Array));
    expect(logAction).toHaveBeenCalledWith('org-1', 'cli-system', 'template_generated', 'templates', 'tpl-1', {
      form_type: 'vet_invoice',
      field_count: 4,
      source_files: ['vet_invoice_1.txt', 'vet_invoice_2.txt'],
    });
  });

  it('retries once on invalid JSON and succeeds if the correction is valid', async () => {
    invokeModel.mockResolvedValueOnce('NOT VALID JSON').mockResolvedValueOnce(VALID_SCHEMA);

    const template = await generateTemplate('vet_invoice', FIXTURE_FILES);

    expect(invokeModel).toHaveBeenCalledTimes(2);
    expect(template.form_type).toBe('vet_invoice');
  });

  it('throws after the retry also fails, and never persists a template', async () => {
    invokeModel.mockResolvedValueOnce('NOT VALID JSON').mockResolvedValueOnce('STILL NOT VALID');

    await expect(generateTemplate('vet_invoice', FIXTURE_FILES)).rejects.toThrow(/failed Zod validation after retry/);
    expect(insertTemplate).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('never leaks a raw card number into the prompt sent to Bedrock', async () => {
    invokeModel.mockResolvedValueOnce(VALID_SCHEMA);
    await generateTemplate('vet_invoice', FIXTURE_FILES);

    const [, userPrompt] = invokeModel.mock.calls[0] as [string, string];
    expect(userPrompt).not.toMatch(/\d{13,}/);
  });
});

describe('approveTemplate() (B2)', () => {
  it('flips status to approved and audits it', async () => {
    (client.getTemplate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'tpl-1', org_id: 'org-1', form_type: 'vet_invoice', status: 'pending_review',
    });
    (client.setTemplateApproved as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'tpl-1', org_id: 'org-1', form_type: 'vet_invoice', status: 'approved',
    });

    const result = await approveTemplate('tpl-1');

    expect(result?.status).toBe('approved');
    expect(logAction).toHaveBeenCalledWith('org-1', 'cli-system', 'template_approved', 'templates', 'tpl-1', {
      form_type: 'vet_invoice',
    });
  });

  it('is a no-op (and does not double-audit) if already approved', async () => {
    (client.getTemplate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'tpl-1', org_id: 'org-1', form_type: 'vet_invoice', status: 'approved',
    });

    const result = await approveTemplate('tpl-1');

    expect(result).toBeNull();
    expect(client.setTemplateApproved).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('throws for an unknown template id', async () => {
    (client.getTemplate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(approveTemplate('nope')).rejects.toThrow(/not found/);
  });
});
