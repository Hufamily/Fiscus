import { useEffect, useState } from "react";
import { api } from "../api";
import type { Template } from "../types";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { useSession } from "../lib/session";
import { can } from "../lib/rbac";

export function TemplatesPage() {
  const { role } = useSession();
  const canApprove = can(role, "approve_templates");
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { api.listTemplates().then(setTemplates); }, []);

  async function approve(id: string) {
    setBusy(id);
    const updated = await api.approveTemplate(id);
    setTemplates((ts) => ts?.map((t) => (t.id === id ? updated : t)) ?? null);
    setBusy(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Templates</h1>
        <p className="mt-1 text-sm text-slate-500">
          Field templates the agent generated from example documents. A reviewer approves one before it is trusted for auto-extraction.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates?.map((t) => (
          <Card key={t.id} className="flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{t.form_type.replace(/_/g, " ")}</h3>
                <StatusBadge status={t.status} />
              </div>
              <p className="mt-1 text-sm text-slate-500">{t.field_count} fields</p>
            </div>
            {t.status === "pending_review" && canApprove && (
              <button
                onClick={() => approve(t.id)}
                disabled={busy === t.id}
                className="mt-4 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
              >
                {busy === t.id ? "Approving…" : "Approve template"}
              </button>
            )}
          </Card>
        ))}
        {!templates && <p className="text-slate-400">Loading…</p>}
      </div>
    </div>
  );
}
