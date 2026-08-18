import { useState, useEffect } from "react";
import { isFallbackActive, subscribeFallback } from "../api/fallbackState";

export function ApiFallbackBanner() {
  const [active, setActive] = useState(isFallbackActive);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => subscribeFallback(setActive), []);

  if (!active || dismissed) return null;

  return (
    <div className="border-b border-bronze/20 bg-bronze/5 px-4 py-2.5">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <p className="text-sm text-bronze">
          <span className="font-medium">Live API unreachable</span>
          {" — showing demo data instead."}
        </p>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-full px-2 py-0.5 text-xs text-bronze hover:bg-bronze/10"
          aria-label="Dismiss banner"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
