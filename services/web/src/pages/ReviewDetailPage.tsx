import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Transaction, ExtractedField } from "../types";
import { Card } from "../components/Card";
import { useSession } from "../lib/session";
import { can } from "../lib/rbac";

function confidenceHint(c: number) {
  if (c >= 0.9) return { ring: "border-slate-300", note: "" };
  if (c >= 0.75) return { ring: "border-amber-300", note: "Low confidence, please verify" };
  return { ring: "border-rose-300", note: "The agent is unsure, please check" };
}

export function ReviewDetailPage() {
  const { docId = "" } = useParams();
  const nav = useNavigate();
  const { role } = useSession();
  const canCorrect = can(role, "apply_corrections");

  const [txn, setTxn] = useState<Transaction | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.getTransactionForDoc(docId).then(setTxn); }, [docId]);

  if (!txn) return <Card className="text-slate-400">Loading extraction…</Card>;

  const setField = (f: ExtractedField, v: string) => setEdits((e) => ({ ...e, [f.key]: v }));

  async function approve() {
    if (!txn) return;
    setSaving(true);
    // Persist any edited fields as corrections (the "learned memory" the charter describes).
    for (const f of txn.extracted_fields) {
      const next = edits[f.key];
      if (next !== undefined && next !== f.value) {
        await api.applyCorrection({
          transaction_id: txn.id, field: f.key, original_value: f.value, corrected_value: next,
        });
      }
    }
    await api.approveTransaction(txn.id);
    setSaving(false);
    nav("/review");
  }

  return (
    <div className="space-y-6">
      <button onClick={() => nav("/review")} className="text-sm text-slate-500 hover:underline">← Back to queue</button>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex min-h-[320px] items-center justify-center bg-slate-100 text-slate-400">
          <div className="text-center">
            <div className="text-5xl">📄</div>
            <p className="mt-2 text-sm">Document preview</p>
            <p className="text-xs">served from S3 with logged, restricted access</p>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">Extracted fields</h2>
          <p className="mb-4 text-sm text-slate-500">
            Correct anything wrong before approving. Edits are saved as corrections the agent learns from.
          </p>
          <div className="space-y-4">
            {txn.extracted_fields.map((f) => {
              const hint = confidenceHint(f.confidence);
              const val = edits[f.key] ?? f.value;
              return (
                <div key={f.key}>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">{f.label}</label>
                    <span className="text-xs text-slate-400">{Math.round(f.confidence * 100)}% conf.</span>
                  </div>
                  <input
                    value={val}
                    disabled={!canCorrect}
                    onChange={(e) => setField(f, e.target.value)}
                    className={`w-full rounded-md border px-3 py-2 text-sm disabled:bg-slate-50 ${hint.ring}`}
                  />
                  {hint.note && <p className="mt-1 text-xs text-amber-600">{hint.note}</p>}
                </div>
              );
            })}
          </div>

          {canCorrect ? (
            <button
              onClick={approve}
              disabled={saving}
              className="mt-6 w-full rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
            >
              {saving ? "Saving corrections…" : "Approve transaction"}
            </button>
          ) : (
            <p className="mt-6 text-sm text-slate-500">Your role can view this extraction but not correct or approve it.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
