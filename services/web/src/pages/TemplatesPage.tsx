import { useEffect, useState, Fragment } from "react";
import { api } from "../api";
import type { Template } from "../types";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { Skeleton } from "../components/Skeleton";
import { HelpHint } from "../components/HelpHint";
import { useSession } from "../lib/session";
import { can } from "../lib/rbac";

export function TemplatesPage() {
  const { role } = useSession();
  const canApprove = can(role, "approve_templates");
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

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
        <h1 className="text-3xl font-medium tracking-tight">Templates</h1>
        <p className="mt-1 text-sm text-faint">
          When the agent meets a new kind of form, it proposes a template. A reviewer approves it before it's trusted.
        </p>
      </div>
      <HelpHint>
        A template is the agent's map of a form: which spots hold the date, the total, the vendor. Once one is approved, every future document of that kind is read automatically.
      </HelpHint>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!templates
          ? Array.from({ length: 3 }).map((_, i) => <Card key={i}><Skeleton className="h-20" /></Card>)
          : templates.map((t) => (
            <Card key={t.id} className={`flex flex-col justify-between ${t.status === "pending_review" ? "border-amber-200" : ""}`}>
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-medium">{t.form_type.replace(/_/g, " ")}</h3>
                  <StatusBadge status={t.status} />
                </div>
                <p className="figure mt-1 text-sm text-faint">{t.field_count} fields · learned from an example</p>
                <button
                  onClick={() => setOpenId(openId === t.id ? null : t.id)}
                  className="mt-2 text-xs text-moss hover:underline"
                >
                  {openId === t.id ? "Hide fields" : "See what it reads"}
                </button>
                {openId === t.id && (
                  <ul className="mt-3 space-y-1.5 rounded-lg border border-hairline bg-paper p-3">
                    {t.fields.map((f) => (
                      <Fragment key={f.key}>
                        <li className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="text-faint">{f.label}</span>
                          <span className="figure truncate text-ink">{f.sample}</span>
                        </li>
                      </Fragment>
                    ))}
                  </ul>
                )}
              </div>
              {t.status === "pending_review" && canApprove && (
                <button
                  onClick={() => approve(t.id)}
                  disabled={busy === t.id}
                  className="mt-4 rounded-full bg-moss px-3 py-1.5 text-sm font-semibold text-white hover:bg-moss-dark disabled:opacity-40"
                >
                  {busy === t.id ? "Approving…" : "Approve template"}
                </button>
              )}
            </Card>
          ))}
      </div>
    </div>
  );
}
