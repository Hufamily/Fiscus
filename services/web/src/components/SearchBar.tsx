import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { SearchResult } from "../types";
import { money, shortDate } from "../lib/format";

// B3 semantic search surface. Real endpoint: cosine similarity over VECTOR(1536)
// embeddings in CockroachDB's distributed vector index; this UI doesn't care which.
export function SearchBar() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!q.trim()) { setResults(null); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      const r = await api.searchTransactions(q);
      setResults(r);
      setBusy(false);
      setOpen(true);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div ref={boxRef} className="relative hidden md:block">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => q && setOpen(true)}
        placeholder='Search…'
        className="w-36 rounded-full border border-hairline bg-paper px-4 py-1.5 text-sm transition-all placeholder:text-faint/70 focus:w-64 focus:border-moss focus:outline-none"
      />
      {open && (
        <div className="absolute right-0 top-10 z-40 w-96 rounded-xl border border-hairline bg-surface p-2 shadow-card">
          {busy ? (
            <p className="px-3 py-4 text-sm text-faint">Searching…</p>
          ) : !results || results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-faint">No matches. The real search is semantic, "that expensive dinner thing" would find the gala.</p>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.transaction_id}>
                  <button
                    onClick={() => { setOpen(false); setQ(""); nav(`/review/${r.document_id}`); }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-paper"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{r.doc_name}</p>
                      <p className="truncate text-xs text-faint">{r.snippet}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {r.amount_cents > 0 && <p className="figure text-sm">{money(r.amount_cents)}</p>}
                      <p className="figure text-[10px] text-faint">{shortDate(r.txn_date)} · {(r.score * 100).toFixed(0)}%</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-hairline/60 px-3 pb-1 pt-2 font-mono text-[10px] text-faint">
            semantic search · CockroachDB vector index (B3)
          </p>
        </div>
      )}
    </div>
  );
}
