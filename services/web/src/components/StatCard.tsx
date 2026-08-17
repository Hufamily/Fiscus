import type { ReactNode } from "react";
import { Card } from "./Card";

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wider text-faint">{label}</p>
      <p className="figure mt-2 text-3xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </Card>
  );
}
