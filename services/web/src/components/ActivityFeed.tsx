import type { ActivityEvent } from "../types";
import { shortDate } from "../lib/format";

const DOT: Record<string, string> = {
  document_uploaded: "bg-blue-400",
  fields_extracted: "bg-violet-400",
  correction_applied: "bg-amber-400",
  transaction_approved: "bg-emerald-400",
  template_generated: "bg-violet-400",
  template_approved: "bg-emerald-400",
};

export function ActivityFeed({ events, limit }: { events: ActivityEvent[]; limit?: number }) {
  const rows = limit ? events.slice(0, limit) : events;
  return (
    <ul className="space-y-3">
      {rows.map((e) => (
        <li key={e.id} className="flex gap-3">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[e.action] ?? "bg-slate-300"}`} />
          <div className="min-w-0">
            <p className="text-sm text-slate-700">{e.detail}</p>
            <p className="text-xs text-slate-400">
              {e.is_agent ? "🤖 " : ""}{e.actor} · {shortDate(e.created_at)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
