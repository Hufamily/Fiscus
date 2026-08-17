import type { ActivityEvent } from "../types";
import { shortDate } from "../lib/format";

const DOT: Record<string, string> = {
  document_uploaded: "bg-stone-400",
  fields_extracted: "bg-bronze",
  correction_applied: "bg-amber-500",
  transaction_approved: "bg-moss",
  template_generated: "bg-bronze",
  template_approved: "bg-moss",
};

export function ActivityFeed({ events, limit }: { events: ActivityEvent[]; limit?: number }) {
  const rows = limit ? events.slice(0, limit) : events;
  return (
    <ul className="space-y-0">
      {rows.map((e, i) => (
        <li key={e.id} className={`flex gap-3 py-3 ${i !== rows.length - 1 ? "border-b border-hairline/60" : ""}`}>
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[e.action] ?? "bg-stone-300"}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">{e.detail}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-faint">
              {e.is_agent && (
                <span className="rounded-full bg-bronze/10 px-1.5 py-px font-mono text-[10px] font-medium text-bronze">agent</span>
              )}
              {e.actor} · {shortDate(e.created_at)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
