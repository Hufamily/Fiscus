import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { ActivityEvent } from "../types";
import { Card } from "../components/Card";
import { ActivityFeed } from "../components/ActivityFeed";
import { RowSkeleton } from "../components/Skeleton";

type ActorFilter = "all" | "agent" | "human";
const ACTION_LABELS: Record<string, string> = {
  document_uploaded: "uploads",
  fields_extracted: "extractions",
  correction_applied: "corrections",
  transaction_approved: "approvals",
  template_generated: "templates",
  template_approved: "templates",
};

export function ActivityPage() {
  const [activity, setActivity] = useState<ActivityEvent[] | null>(null);
  const [actor, setActor] = useState<ActorFilter>("all");
  const [action, setAction] = useState<string>("all");

  useEffect(() => { api.getActivity().then(setActivity); }, []);

  const actionKinds = useMemo(
    () => Array.from(new Set((activity ?? []).map((e) => ACTION_LABELS[e.action] ?? e.action))),
    [activity]
  );

  const filtered = (activity ?? []).filter((e) => {
    if (actor === "agent" && !e.is_agent) return false;
    if (actor === "human" && e.is_agent) return false;
    if (action !== "all" && (ACTION_LABELS[e.action] ?? e.action) !== action) return false;
    return true;
  });

  const pill = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs ${active ? "bg-moss text-white" : "border border-hairline text-faint hover:text-ink"}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Activity log</h1>
        <p className="mt-1 text-sm text-faint">
          Append-only audit trail. Every human and agent action is recorded, nothing edits history.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setActor("all")} className={pill(actor === "all")}>everyone</button>
        <button onClick={() => setActor("human")} className={pill(actor === "human")}>people</button>
        <button onClick={() => setActor("agent")} className={pill(actor === "agent")}>agent</button>
        <span className="mx-1 h-4 w-px bg-hairline" />
        <button onClick={() => setAction("all")} className={pill(action === "all")}>all actions</button>
        {actionKinds.map((k) => (
          <button key={k} onClick={() => setAction(k)} className={pill(action === k)}>{k}</button>
        ))}
      </div>

      <Card>
        {!activity ? (
          <RowSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">Nothing matches those filters.</p>
        ) : (
          <ActivityFeed events={filtered} />
        )}
      </Card>
    </div>
  );
}
