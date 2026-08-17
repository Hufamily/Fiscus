// Approve a template: flip status to 'approved' + audit. Second approve is a no-op.

import { logAction } from '../../../../lib/audit';
import type { TemplateRow } from './types';
import { getTemplate, setTemplateApproved, ORG_ID } from './client';

export async function approveTemplate(id: string): Promise<TemplateRow | null> {
  const existing = await getTemplate(id);
  if (!existing) throw new Error(`Template ${id} not found`);

  if (existing.status === 'approved') {
    console.log(`Template ${id} is already approved. Nothing to do.`);
    return null;
  }

  const updated = await setTemplateApproved(id);

  await logAction(ORG_ID, 'cli-system', 'template_approved', 'templates', id, {
    form_type: existing.form_type,
  });

  return updated;
}
