import { useState } from "react";

// Plain-language explainers for volunteers with zero accounting/tooling background.
// Dismissal is per-pageload on purpose: in the demo we WANT judges to see these.
export function HelpHint({ children }: { children: string }) {
  const [shown, setShown] = useState(true);
  if (!shown) return null;
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-moss/20 bg-moss-soft px-4 py-3">
      <p className="text-sm text-moss-dark">{children}</p>
      <button onClick={() => setShown(false)} className="text-xs text-moss-dark/60 hover:text-moss-dark">dismiss</button>
    </div>
  );
}
