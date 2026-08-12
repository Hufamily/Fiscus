import type { ReactNode } from "react";
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-hairline bg-surface p-5 shadow-card ${className}`}>{children}</div>;
}
