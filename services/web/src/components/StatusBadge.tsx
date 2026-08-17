const MAP: Record<string, string> = {
  needs_review: "bg-amber-100 text-amber-900",
  pending_review: "bg-amber-100 text-amber-900",
  extracting: "bg-bronze/10 text-bronze",
  uploaded: "bg-hairline/60 text-faint",
  approved: "bg-moss-soft text-moss-dark",
  rejected: "bg-rose-100 text-rose-800",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = MAP[status] ?? "bg-hairline/60 text-faint";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
