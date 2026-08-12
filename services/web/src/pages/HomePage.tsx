import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { FiscusDocument, ActivityEvent, LearnedCorrection, LeadershipSummary, ReviewSession } from "../types";
import { Card } from "../components/Card";
import { StatCard } from "../components/StatCard";
import { ActivityFeed } from "../components/ActivityFeed";
import { money } from "../lib/format";
import { useSession, DEMO_NAMES, greeting } from "../lib/session";
import { can } from "../lib/rbac";

export function HomePage() {
  const { role } = useSession();
  const [docs, setDocs] = useState<FiscusDocument[] | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[] | null>(null);
  const [learned, setLearned] = useState<LearnedCorrection[] | null>(null);
  const [summary, setSummary] = useState<LeadershipSummary | null>(null);
  const [session, setSession] = useState<ReviewSession | null>(null);

  useEffect(() => {
    const load = () => {
      api.listDocuments().then(setDocs);
      api.getActivity().then(setActivity);
      api.getLearnedCorrections().then(setLearned);
      api.getReviewSession().then(setSession);
      if (can(role, "view_aggregate_reports")) api.getLeadershipSummary().then(setSummary);
    };
    load();
    // Numbers stay honest when you come back to this tab/page (P3-21).
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [role]);

  const pending = docs?.filter((d) => d.status === "needs_review").length ?? 0;
  const approved = docs?.filter((d) => d.status === "approved").length ?? 0;
  const canUpload = can(role, "upload_documents");
  const canReview = can(role, "review_extractions");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-bronze">Green Paws Rescue</p>
          <h1 className="mt-1 text-4xl font-medium tracking-tight">{greeting()}, {DEMO_NAMES[role]}.</h1>
          <p className="mt-2 text-sm text-faint">
            {pending > 0
              ? `${pending} document${pending === 1 ? "" : "s"} could use your eyes.`
              : "All caught up. Nothing waiting on you."}
          </p>
        </div>
        <div className="flex gap-2">
          {canUpload && <Link to="/upload" className="rounded-full bg-moss px-4 py-2 text-sm font-semibold text-white hover:bg-moss-dark">Upload a document</Link>}
          {canReview && <Link to="/review" className="rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-semibold text-ink hover:border-stone-300">Review{pending ? ` · ${pending}` : ""}</Link>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending review" value={pending} hint="awaiting a reviewer" />
        <StatCard label="Approved" value={approved} hint="processed this period" />
        <StatCard label="Learned rules" value={learned?.length ?? "—"} hint="auto-applied by the agent" />
        <StatCard
          label={summary ? "Total spend · YTD" : "Documents"}
          value={summary ? money(summary.total_spend_cents) : (docs?.length ?? "—")}
          hint={summary ? "aggregate, all categories" : "in the system"}
        />
      </div>

      {session && canReview && (
        <Card className="flex items-center justify-between border-moss/25">
          <div>
            <p className="font-display text-lg font-medium">Pick up where you left off</p>
            <p className="mt-0.5 text-sm text-faint">
              {session.pending_document_ids.length} document{session.pending_document_ids.length === 1 ? "" : "s"} left in your review session. The agent saved your place.
            </p>
          </div>
          <Link
            to={`/review/${session.pending_document_ids[session.current_index]}`}
            className="shrink-0 rounded-full bg-moss px-4 py-2 text-sm font-semibold text-white hover:bg-moss-dark"
          >
            Continue →
          </Link>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xl font-medium">Recent activity</h2>
            <Link to="/activity" className="text-sm text-moss hover:underline">Full log</Link>
          </div>
          {activity ? <ActivityFeed events={activity} limit={5} /> : <p className="text-sm text-faint">Loading…</p>}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="text-xl font-medium">The agent has learned</h2>
          <p className="mb-4 mt-1 text-sm text-faint">
            Your corrections, generalized and re-applied to similar documents.
          </p>
          <ul className="space-y-3">
            {learned?.map((l) => (
              <li key={l.id} className="rounded-lg border border-bronze/20 bg-bronze/5 p-3">
                <p className="text-sm text-ink">{l.learned_rule}</p>
                <p className="mt-1.5 font-mono text-[11px] text-bronze">
                  {l.doc_type.replace(/_/g, " ")} · applied {l.times_applied}×
                </p>
              </li>
            ))}
            {!learned && <p className="text-sm text-faint">Loading…</p>}
          </ul>
          <Link to="/assistant" className="mt-4 inline-block text-sm text-moss hover:underline">Ask the agent →</Link>
        </Card>
      </div>
    </div>
  );
}
