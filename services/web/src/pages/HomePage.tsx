import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { FiscusDocument, ActivityEvent, LearnedCorrection, LeadershipSummary } from "../types";
import { Card } from "../components/Card";
import { StatCard } from "../components/StatCard";
import { ActivityFeed } from "../components/ActivityFeed";
import { money } from "../lib/format";
import { useSession } from "../lib/session";
import { can } from "../lib/rbac";
import { ROLE_LABELS } from "../lib/rbac";

export function HomePage() {
  const { role } = useSession();
  const [docs, setDocs] = useState<FiscusDocument[] | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[] | null>(null);
  const [learned, setLearned] = useState<LearnedCorrection[] | null>(null);
  const [summary, setSummary] = useState<LeadershipSummary | null>(null);

  useEffect(() => {
    api.listDocuments().then(setDocs);
    api.getActivity().then(setActivity);
    api.getLearnedCorrections().then(setLearned);
    if (can(role, "view_aggregate_reports")) api.getLeadershipSummary().then(setSummary);
  }, [role]);

  const pending = docs?.filter((d) => d.status === "needs_review").length ?? 0;
  const approved = docs?.filter((d) => d.status === "approved").length ?? 0;
  const canUpload = can(role, "upload_documents");
  const canReview = can(role, "review_extractions");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Green Paws Rescue</h1>
        <p className="mt-1 text-sm text-slate-500">
          Signed in as {ROLE_LABELS[role]}. Here's where things stand.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending review" value={pending} hint="documents awaiting a reviewer" />
        <StatCard label="Approved" value={approved} hint="processed this period" />
        <StatCard label="Learned rules" value={learned?.length ?? "—"} hint="corrections the agent auto-applies" />
        <StatCard
          label={summary ? "Total spend (YTD)" : "Documents"}
          value={summary ? money(summary.total_spend_cents) : (docs?.length ?? "—")}
          hint={summary ? "aggregate, all categories" : "in the system"}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        {canUpload && <Link to="/upload" className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Upload a document</Link>}
        {canReview && <Link to="/review" className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-brand-dark ring-1 ring-slate-300 hover:bg-slate-50">Review queue{pending ? ` (${pending})` : ""}</Link>}
        <Link to="/assistant" className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-brand-dark ring-1 ring-slate-300 hover:bg-slate-50">Ask the agent</Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent activity</h2>
            <Link to="/activity" className="text-sm text-brand-dark hover:underline">View all</Link>
          </div>
          {activity ? <ActivityFeed events={activity} limit={5} /> : <p className="text-sm text-slate-400">Loading…</p>}
        </Card>

        <Card>
          <h2 className="mb-1 text-lg font-semibold">What the agent has learned</h2>
          <p className="mb-3 text-sm text-slate-500">
            Corrections generalized into memory and re-applied automatically to similar documents.
          </p>
          <ul className="space-y-3">
            {learned?.map((l) => (
              <li key={l.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <p className="text-sm text-slate-700">{l.learned_rule}</p>
                <p className="mt-1 text-xs text-slate-400">{l.doc_type.replace(/_/g, " ")} · applied {l.times_applied}×</p>
              </li>
            ))}
            {!learned && <p className="text-sm text-slate-400">Loading…</p>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
