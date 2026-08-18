// generateSummary(): enforce RBAC -> aggregate -> redact -> Claude -> store -> audit.

import { redact } from '../../../../lib/redact';
import { logAction } from '../../../../lib/audit';
import { enforceAccess, type AccessSubject } from '../../../../lib/rbac';
import {
  IS_MOCK,
  invokeModel,
  getAggregates,
  insertSummary,
} from './client';
import type { SummaryRow, AggregateRow } from './types';

const SYSTEM_PROMPT = `You are writing an executive financial summary for a volunteer nonprofit organization.
Rules:
- 120-180 words exactly.
- Mention where money went by category totals only.
- Note at least one trend or observation.
- Note what spending is pending review.
- Do NOT mention vendor names, individual transaction IDs, or any person's name.
- Cite only category-level totals and counts.
- Write in plain, professional prose. No bullet points.`;

function buildAggregatesText(rows: AggregateRow[]): string {
  return rows
    .map((r) => `${r.category} / ${r.status}: ${r.count} transaction(s), $${(r.total_cents / 100).toFixed(2)}`)
    .join('\n');
}

// Deterministic 120-180 word mock summary referencing seeded category totals.
// No vendor names in the output (verified by CLI test grep).
const MOCK_SUMMARY = `During the review period, the organization recorded total expenditures of $656.27 across three transactions in two spending categories. Veterinary expenses represented the largest share, totaling $568.77 across two transactions; of this, $244.69 has been approved while $324.08 remains pending review. Office supply purchases totaled $87.50 and have been fully approved.

A notable trend is that veterinary costs account for approximately 87 percent of total spending, suggesting this category warrants close attention in future budget planning. The single pending transaction—a veterinary expense—should be prioritized for review to ensure timely record closure.

Overall, approved expenditures total $332.19 and pending expenditures total $324.08. Leadership is encouraged to complete the outstanding review to maintain an accurate picture of committed funds for the current period.`;

export async function generateSummary(periodLabel: string, subject: AccessSubject): Promise<SummaryRow> {
  // 0. D1 enforcement — only treasurer/leadership hold view_aggregate_reports;
  // a denied attempt is audit-logged by enforceAccess before it throws.
  await enforceAccess(subject, {
    capability: 'view_aggregate_reports',
    targetTable: 'summaries',
    targetId: periodLabel,
  });

  // 1. Aggregate-only query (no row-level data — RBAC constraint per AGENTS.md §5)
  const aggregates = await getAggregates();
  const aggregatesText = buildAggregatesText(aggregates);

  // 2. Redact belt-and-suspenders (numbers only here, but rule is unconditional)
  const redactedText = redact(aggregatesText);
  const userPrompt = `Period: ${periodLabel}\n\nFinancial aggregates:\n${redactedText}\n\nWrite the executive summary now.`;

  let body: string;

  if (IS_MOCK) {
    body = MOCK_SUMMARY;
    process.stderr.write(`[mock] generating summary for period: ${periodLabel}\n`);
  } else {
    body = await invokeModel(SYSTEM_PROMPT, userPrompt);
  }

  // 3. Store
  const summary = await insertSummary(periodLabel, body);

  // 4. Audit
  await logAction(subject.orgId, subject.volunteerId, 'summary_generated', 'summaries', summary.id, { period_label: periodLabel });

  return summary;
}
