import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { FiscusDocument } from "../types";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { shortDate } from "../lib/format";

export function ReviewQueuePage() {
  const [docs, setDocs] = useState<FiscusDocument[] | null>(null);

  useEffect(() => { api.listDocuments().then(setDocs); }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          Documents the agent has extracted. Open one to check the fields and correct anything it got wrong.
        </p>
      </div>

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Document</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Uploaded</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {docs?.map((d) => (
              <tr key={d.id} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3 font-medium">{d.s3_key.split("/").pop()}</td>
                <td className="px-5 py-3 text-slate-600">{d.doc_type.replace(/_/g, " ")}</td>
                <td className="px-5 py-3 text-slate-600">{shortDate(d.created_at)}</td>
                <td className="px-5 py-3"><StatusBadge status={d.status} /></td>
                <td className="px-5 py-3 text-right">
                  {d.status === "needs_review" ? (
                    <Link to={`/review/${d.id}`} className="font-medium text-brand-dark hover:underline">Review →</Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
            {docs && docs.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">Nothing in the queue.</td></tr>
            )}
            {!docs && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">Loading…</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
