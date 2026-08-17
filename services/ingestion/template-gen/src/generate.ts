// Core template generation logic: redact → Bedrock → Zod validate → embed → persist.

import { readFileSync } from 'fs';
import path from 'path';
import { redact } from '../../../../lib/redact';
import { embed } from '../../../../lib/embeddings';
import { logAction } from '../../../../lib/audit';
import { SchemaJsonSchema, type SchemaJson, type TemplateRow } from './types';
import { invokeModel, insertTemplate, IS_MOCK, ORG_ID } from './client';

const SYSTEM_PROMPT = `You are a document schema extractor for financial forms.
Given one or more example documents of the same type, output ONLY a valid JSON array of field definitions.
No explanation, no markdown, no code blocks — output pure JSON only.
Each element must conform exactly to this TypeScript type:
  { key: string; label: string; type: "string"|"amount"|"date"|"category"; expected_pattern?: string; sample: string }
Rules:
- Choose "amount" for any monetary value, "date" for any date, "category" for enumerated/fixed-choice fields, "string" for all others.
- "key" must be snake_case and unique within the array.
- "sample" must be a realistic value from the documents.
- Extract at least 4 fields covering the most important information in the form.`;

function buildUserPrompt(formType: string, redactedDocs: string[]): string {
  const sections = redactedDocs.map((doc, i) => `DOCUMENT ${i + 1}:\n${doc}`).join('\n\n');
  return `Form type: ${formType}\n\n${sections}\n\nExtract a reusable field schema for documents of this type.`;
}

function extractJson(raw: string): string {
  // Strip markdown code fences if the model ignored the system prompt
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fence ? fence[1].trim() : raw.trim();
}

async function parseWithRetry(raw: string, formType: string): Promise<SchemaJson> {
  const attempt = (text: string) => {
    try {
      const parsed: unknown = JSON.parse(extractJson(text));
      return SchemaJsonSchema.safeParse(parsed);
    } catch {
      return { success: false as const, error: { message: 'JSON.parse failed' } };
    }
  };

  const first = attempt(raw);
  if (first.success) return first.data;

  console.error(`[warn] Bedrock output failed Zod validation (attempt 1): ${JSON.stringify(first.error)}`);
  console.error('[warn] Retrying with error-correction prompt…');

  const correctionPrompt =
    `Your previous output was not valid JSON or did not match the required schema.\n` +
    `Error: ${JSON.stringify(first.error)}\n` +
    `Output ONLY the corrected JSON array. No explanation.`;

  const raw2 = await invokeModel(SYSTEM_PROMPT, correctionPrompt, formType);
  const second = attempt(raw2);
  if (second.success) return second.data;

  throw new Error(
    `Bedrock output failed Zod validation after retry.\nFinal error: ${JSON.stringify(second.error)}\nRaw output: ${raw2}`,
  );
}

export async function generateTemplate(
  formType: string,
  filePaths: string[],
): Promise<TemplateRow> {
  if (filePaths.length < 2) {
    throw new Error('Provide at least 2 example files (--files <a> <b> ...)');
  }

  // 1. Read + redact each document
  const redactedDocs = filePaths.map((fp) => {
    const raw = readFileSync(path.resolve(fp), 'utf-8');
    return redact(raw);
  });

  // 2. Build prompt and log it in mock mode so the user can verify redaction
  const userPrompt = buildUserPrompt(formType, redactedDocs);
  if (IS_MOCK) {
    console.error('\n[mock] === Redacted prompt sent to Bedrock ===\n' + userPrompt + '\n=== end prompt ===\n');
  }

  // 3. Invoke Bedrock (with Zod retry)
  const rawOutput = await invokeModel(SYSTEM_PROMPT, userPrompt, formType);
  const schemaJson = await parseWithRetry(rawOutput, formType);

  // 4. Compute embedding of the schema summary
  const schemaSummary = `form_type:${formType} fields:${schemaJson.map((f) => f.key).join(',')}`;
  const embedding = await embed(schemaSummary);

  // 5. Persist template
  const template = await insertTemplate(formType, schemaJson, embedding);

  // 6. Audit
  await logAction(ORG_ID, 'cli-system', 'template_generated', 'templates', template.id, {
    form_type: formType,
    field_count: schemaJson.length,
    source_files: filePaths.map((f) => path.basename(f)),
  });

  return template;
}
