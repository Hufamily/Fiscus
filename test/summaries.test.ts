import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logAction } = vi.hoisted(() => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/audit', () => ({ logAction }));

const { getAggregates, insertSummary, invokeModel } = vi.hoisted(() => ({
  getAggregates: vi.fn().mockResolvedValue([
    { category: 'veterinary', status: 'approved', total_cents: 1000, count: 1 },
  ]),
  insertSummary: vi.fn().mockResolvedValue({
    id: 'sum-1',
    org_id: 'org-1',
    period_label: 'YTD',
    body: 'stub summary',
    created_at: new Date().toISOString(),
  }),
  invokeModel: vi.fn().mockResolvedValue('stub summary'),
}));
vi.mock('../services/api/summaries/src/client', () => ({
  IS_MOCK: true,
  getAggregates,
  insertSummary,
  invokeModel,
}));

import { generateSummary } from '../services/api/summaries/src/generate';
import { AccessDeniedError, type AccessSubject } from '../lib/rbac';

const subject = (role: AccessSubject['role']): AccessSubject => ({
  volunteerId: 'vol-1',
  orgId: 'org-1',
  role,
});

beforeEach(() => {
  logAction.mockClear();
  getAggregates.mockClear();
  insertSummary.mockClear();
});

describe('generateSummary — D1 RBAC gate', () => {
  it('rejects data_entry before touching aggregates or storage, and audits the denial', async () => {
    await expect(generateSummary('YTD', subject('data_entry'))).rejects.toThrow(AccessDeniedError);

    expect(getAggregates).not.toHaveBeenCalled();
    expect(insertSummary).not.toHaveBeenCalled();
    expect(logAction).toHaveBeenCalledWith('org-1', 'vol-1', 'access_denied', 'summaries', 'YTD', {
      role: 'data_entry',
      capability: 'view_aggregate_reports',
    });
  });

  it('rejects reviewer the same way', async () => {
    await expect(generateSummary('YTD', subject('reviewer'))).rejects.toThrow(AccessDeniedError);
  });

  it('allows treasurer and leadership through to generation', async () => {
    for (const role of ['treasurer', 'leadership'] as const) {
      const summary = await generateSummary('YTD', subject(role));
      expect(summary.id).toBe('sum-1');
    }
    expect(insertSummary).toHaveBeenCalledTimes(2);
    expect(logAction).toHaveBeenCalledWith('org-1', 'vol-1', 'summary_generated', 'summaries', 'sum-1', {
      period_label: 'YTD',
    });
  });
});
