import { z } from 'zod';

export const FieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['string', 'amount', 'date', 'category']),
  expected_pattern: z.string().optional(),
  sample: z.string(),
});

export const SchemaJsonSchema = z.array(FieldSchema).min(1);

export type SchemaField = z.infer<typeof FieldSchema>;
export type SchemaJson = z.infer<typeof SchemaJsonSchema>;

export interface TemplateRow {
  id: string;
  org_id: string;
  form_type: string;
  schema_json: SchemaJson;
  embedding: number[];
  status: 'pending_review' | 'approved';
  created_at: string;
}
