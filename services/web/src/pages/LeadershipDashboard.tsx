import { useEffect, useState } from "react";
import { api } from "../api";
import type { LeadershipSummary, ActivityEvent } from "../types";
import { Card } from "../components/Card";
import { ActivityFeed } from "../components/ActivityFeed";
import { money } from "../lib/format";
import { useSession } from "../lib/session";
import { can } from "../lib/rbac";

export function LeadershipDashboard() {
  const { role } = useSession();
  const allowed = can(role, "view_aggregate_reports");
  const [s, setS] = useState<LeadershipSummary | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[] | null>(null);

  useEffect(() => {
    if (allowed) {
      api.getLeadershipSummary().then(setS);
      api.getActivity().then(setActivity);
    }
  }, [allowed]);

  if (!allowed) {
    return (
      <Card className="text-faint">
        Aggregate reporting is limited to Treasurer and Leadership roles. This is enforced at the
        query layer, not just hidden here, so lower roles cannot request these figures at all.
      </Card>
    );
  }
  if (!s) return <Card className="text-faint">Loading summary…</Card>;

  const maxMonth = Math.max(...s.monthly_spend_cents.map((m) => m.total_cents));
  const maxCat = Math.max(...s.by_category.map((c) => c.total_cents));
  const avgTxn = Math.round(s.total_spend_cents / s.txn_count);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-medium tracking-tight">Leadership dashboard</h1>
          <p className="mt-1 text-sm text-faint">Aggregate view only. No row-level transactions are exposed to this role.</p>
        </div>
        <span className="rounded-full bg-hairline/50 px-3 py-1 text-sm font-medium text-faint">{s.period_label}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><p className="text-sm text-faint">Total spend</p><p className="mt-1 text-3xl font-medium tracking-tight">{money(s.total_spend_cents)}</p></Card>
        <Card><p className="text-sm text-faint">Transactions</p><p className="mt-1 text-3xl font-medium tracking-tight">{s.txn_count}</p></Card>
        <Card><p className="text-sm text-faint">Avg. transaction</p><p className="mt-1 text-3xl font-medium tracking-tight">{money(avgTxn)}</p></Card>
        <Card><p className="text-sm text-faint">Pending review</p><p className="mt-1 text-3xl font-medium tracking-tight">{s.pending_review_count}</p></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-xl font-medium">Spend by category</h2>
          <div className="space-y-3">
            {s.by_category.map((c) => (
              <div key={c.category}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-ink">{c.category}</span>
                  <span className="font-medium">{money(c.total_cents)}</span>
                </div>
                <div className="h-2 rounded-full bg-hairline/50">
                  <div className="h-2 rounded-full bg-moss" style={{ width: `${(c.total_cents / maxCat) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-xl font-medium">Monthly spend</h2>
          <div className="flex h-48 items-end gap-3">
            {s.monthly_spend_cents.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex w-full flex-1 items-end">
                  <div className="w-full rounded-t bg-moss/80" style={{ height: `${(m.total_cents / maxMonth) * 100}%` }} title={money(m.total_cents)} />
                </div>
                <span className="text-xs text-faint">{m.month}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-xl font-medium">Recent activity</h2>
        {activity ? <ActivityFeed events={activity} limit={6} /> : <p className="text-sm text-faint">Loading…</p>}
      </Card>
    </div>
  );
}
