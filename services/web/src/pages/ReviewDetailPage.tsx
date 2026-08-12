import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Transaction, ExtractedField } from "../types";
import { Card } from "../components/Card";
import { Skeleton } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { useSession } from "../lib/session";
import { can } from "../lib/rbac";

// Confidence as a visual signature: 5-segment meter, colored by band.
function ConfidenceMeter({ value }: { value: number }) {
  const filled = Math.round(value * 5);
  const tone = value >= 0.9 ? "bg-moss" : value >= 0.75 ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className="flex items-center gap-1" title={`${Math.round(value * 100)}% confidence`}>
      <span className="flex gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className={`h-2.5 w-1 rounded-sm ${i < filled ? tone : "bg-hairline"}`} />
        ))}
      </span>
      <span className="figure text-[11px] text-faint">{Math.round(value * 100)}%</span>
    </span>
  );
}

export function ReviewDetailPage() {
  const { docId = "" } = useParams();
  const nav = useNavigate();
  const { role } = useSession();
  const { push } = useToast();
  const canCorrect = can(role, "apply_corrections");

  const [txn, setTxn] = useState<Transaction | null | undefined>(undefined);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.getTransactionForDoc(docId).then(setTxn); }, [docId]);

  if (txn === undefined) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="min-h-[320px]"><Skeleton className="h-full min-h-[280px]" /></Card>
        <Card><div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div></Card>
      </div>
    );
  }
  if (txn === null) {
    return (
      <Card className="text-faint">
        This document is still being read by the agent, or has already been filed.{" "}
        <button onClick={() => nav("/review")} className="text-moss underline">Back to the queue</button>
      </Card>
    );
  }

  const setField = (f: ExtractedField, v: string) => setEdits((e) => ({ ...e, [f.key]: v }));

  async function approve() {
    if (!txn) return;
    setSaving(true);
    const changed: { field: string; from: string; to: string }[] = [];
    for (const f of txn.extracted_fields) {
      const next = edits[f.key];
      if (next !== undefined && next !== f.value) {
        await api.applyCorrection({ transaction_id: txn.id, field: f.key, original_value: f.value, corrected_value: next });
        changed.push({ field: f.label, from: f.value, to: next });
      }
    }
    await api.approveTransaction(txn.id);
    setSaving(false);
    // P1-6: the product thesis, on screen — corrections become memory.
    if (changed.length > 0) {
      const first = changed[0];
      push(
        "Got it — I'll remember that.",
        changed.length === 1
          ? `Future ${txn.category.toLowerCase()} documents like this will use "${first.to}" for ${first.field}.`
          : `${changed.length} corrections saved to memory for documents like this one.`
      );
    } else {
      push("Filed.", "Approved with no changes — nice when that happens.");
    }
    nav("/review");
  }

  return (
    <div className="space-y-6">
      <button onClick={() => nav("/review")} className="text-sm text-faint hover:text-ink hover:underline">← Back to queue</button>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex min-h-[360px] items-center justify-center bg-paper">
          <div className="text-center text-faint">
            <div className="font-display text-5xl">¶</div>
            <p className="mt-2 text-sm">Document preview</p>
            <p className="font-mono text-[11px]">served from S3 · restricted, logged access (A4)</p>
          </div>
        </Card>

        <Card>
          <h2 className="text-xl font-medium">What the agent read</h2>
          <p className="mb-5 mt-1 text-sm text-faint">
            Fix anything wrong before approving — corrections become rules it applies next time.
          </p>
          <div className="space-y-4">
            {txn.extracted_fields.map((f) => {
              const val = edits[f.key] ?? f.value;
              const edited = edits[f.key] !== undefined && edits[f.key] !== f.value;
              return (
                <div key={f.key}>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-sm font-medium text-ink">{f.label}</label>
                    {edited
                      ? <span className="rounded-full bg-bronze/10 px-1.5 py-px font-mono text-[10px] text-bronze">edited</span>
                      : <ConfidenceMeter value={f.confidence} />}
                  </div>
                  <input
                    value={val}
                    disabled={!canCorrect}
                    onChange={(e) => setField(f, e.target.value)}
                    className={`w-full rounded-md border px-3 py-2 text-sm transition-colors disabled:bg-paper ${
                      edited ? "border-bronze/50 bg-bronze/5" : f.confidence < 0.75 ? "border-rose-300" : f.confidence < 0.9 ? "border-amber-300" : "border-hairline bg-surface"
                    }`}
                  />
                  {f.confidence < 0.75 && !edited && (
                    <p className="mt-1 text-xs text-rose-600">The agent wasn't sure about this one — worth a look.</p>
                  )}
                </div>
              );
            })}
          </div>

          {canCorrect ? (
            <button
              onClick={approve}
              disabled={saving}
              className="mt-6 w-full rounded-full bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss-dark disabled:opacity-40"
            >
              {saving ? "Saving…" : Object.keys(edits).length ? "Save corrections & approve" : "Approve"}
            </button>
          ) : (
            <p className="mt-6 text-sm text-faint">Your role can view this extraction but not correct or approve it.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
