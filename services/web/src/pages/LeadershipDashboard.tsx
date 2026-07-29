import { useEffect, useState } from "react";
import { api } from "../api";
import type { LeadershipSummary } from "../types";
import { Card } from "../components/Card";
import { money } from "../lib/format";
import { useSession } from "../lib/session";
import { can } from "../lib/rbac";

export function LeadershipDashboard() {
  const { role } = useSession();
  const allowed = can(role, "view_aggregate_reports");
  const [s, setS] = useState<LeadershipSummary | null>(null);

  useEffect(() => { if (allowed) api.getLeadershipSummary().then(setS); }, [allowed]);

  if (!allowed) {
    return (
      <Card className="text-slate-600">
        Aggregate reporting is limited to Treasurer and Leadership roles. This is enforced at the
        query layer, not just hidden here, so lower roles cannot request these figures at all.
      </Card>
    );
  }
  if (!s) return <Card className="text-slate-400">Loading summary…</Card>;

  const maxMonth = Math.max(...s.monthly_spend_cents.map((m) => m.total_cents));
  const maxCat = Math.max(...s.by_category.map((c) => c.total_cents));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Leadership dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Aggregate view only. No row-level transactions are exposed to this role.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">{s.period_label}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">Total spend</p>
          <p className="mt-1 text-2xl font-semibold">{money(s.total_spend_cents)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Transactions</p>
          <p className="mt-1 text-2xl font-semibold">{s.txn_count}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Pending review</p>
          <p className="mt-1 text-2xl font-semibold">{s.pending_review_count}</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Spend by category</h2>
          <div className="space-y-3">
            {s.by_category.map((c) => (
              <div key={c.category}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-slate-700">{c.category}</span>
                  <span className="font-medium">{money(c.total_cents)}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-brand" style={{ width: `${(c.total_cents / maxCat) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold">Monthly spend</h2>
          <div className="flex h-48 items-end gap-3">
            {s.monthly_spend_cents.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex w-full flex-1 items-end">
                  <div className="w-full rounded-t bg-brand/80" style={{ height: `${(m.total_cents / maxMonth) * 100}%` }} title={money(m.total_cents)} />
                </div>
                <span className="text-xs text-slate-500">{m.month}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
