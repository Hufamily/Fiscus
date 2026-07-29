const MAP: Record<string, string> = {
  needs_review: "bg-amber-100 text-amber-800",
  pending_review: "bg-amber-100 text-amber-800",
  extracting: "bg-blue-100 text-blue-800",
  uploaded: "bg-slate-100 text-slate-700",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = MAP[status] ?? "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
