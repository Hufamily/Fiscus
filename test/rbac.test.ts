import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logAction } = vi.hoisted(() => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/audit', () => ({ logAction }));

import { isAllowed, enforceAccess, AccessDeniedError, type AccessSubject } from '../lib/rbac';

const subject = (role: AccessSubject['role']): AccessSubject => ({
  volunteerId: 'vol-1',
  orgId: 'org-1',
  role,
});

beforeEach(() => {
  logAction.mockClear();
});

describe('isAllowed — each role can only reach the data/endpoints it should', () => {
  it('leadership can view aggregate reports but never row-level transactions', () => {
    expect(isAllowed(subject('leadership'), { capability: 'view_aggregate_reports', targetTable: 'transactions', targetId: 't1' })).toBe(true);
    expect(isAllowed(subject('leadership'), { capability: 'view_row_level_transactions', targetTable: 'transactions', targetId: 't1' })).toBe(false);
  });

  it('treasurer and reviewer have row-level transaction access', () => {
    for (const role of ['treasurer', 'reviewer'] as const) {
      expect(isAllowed(subject(role), { capability: 'view_row_level_transactions', targetTable: 'transactions', targetId: 't1' })).toBe(true);
    }
  });

  it('only treasurer sees aggregate reports besides leadership', () => {
    expect(isAllowed(subject('treasurer'), { capability: 'view_aggregate_reports', targetTable: 'transactions', targetId: 't1' })).toBe(true);
    expect(isAllowed(subject('reviewer'), { capability: 'view_aggregate_reports', targetTable: 'transactions', targetId: 't1' })).toBe(false);
  });

  it('data_entry can only upload/correct their own documents', () => {
    const req = { capability: 'upload_documents' as const, targetTable: 'documents', targetId: 'd1', uploadedBy: 'vol-1' };
    expect(isAllowed(subject('data_entry'), req)).toBe(true);
    expect(isAllowed(subject('data_entry'), { ...req, uploadedBy: 'someone-else' })).toBe(false);
    expect(isAllowed(subject('data_entry'), { ...req, uploadedBy: undefined })).toBe(false);
  });

  it('data_entry cannot approve templates or view aggregate reports', () => {
    expect(isAllowed(subject('data_entry'), { capability: 'approve_templates', targetTable: 'templates', targetId: 'tp1' })).toBe(false);
    expect(isAllowed(subject('data_entry'), { capability: 'view_aggregate_reports', targetTable: 'transactions', targetId: 't1' })).toBe(false);
  });
});

describe('enforceAccess — denied attempts are audit-logged', () => {
  it('rejects a leadership request for row-level transaction data and logs the denial', async () => {
    await expect(
      enforceAccess(subject('leadership'), { capability: 'view_row_level_transactions', targetTable: 'transactions', targetId: 't1' }),
    ).rejects.toThrow(AccessDeniedError);

    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction).toHaveBeenCalledWith('org-1', 'vol-1', 'access_denied', 'transactions', 't1', {
      role: 'leadership',
      capability: 'view_row_level_transactions',
    });
  });

  it('does not log anything when access is allowed', async () => {
    await enforceAccess(subject('treasurer'), { capability: 'view_row_level_transactions', targetTable: 'transactions', targetId: 't1' });
    expect(logAction).not.toHaveBeenCalled();
  });
});
