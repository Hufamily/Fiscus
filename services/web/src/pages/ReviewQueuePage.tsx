import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { FiscusDocument } from "../types";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { RowSkeleton } from "../components/Skeleton";
import { HelpHint } from "../components/HelpHint";
import { shortDate } from "../lib/format";

export function ReviewQueuePage() {
  const [docs, setDocs] = useState<FiscusDocument[] | null>(null);

  useEffect(() => { api.listDocuments().then(setDocs); }, []);

  const pending = docs?.filter((d) => d.status === "needs_review") ?? [];
  const rest = docs?.filter((d) => d.status !== "needs_review") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Review queue</h1>
        <p className="mt-1 text-sm text-faint">
          The agent read these and drafted transactions. Check its work, anything you fix, it learns.
        </p>
      </div>

      <HelpHint>
        Nothing is final until a person approves it. Approving with a fix teaches the agent; approving unchanged tells it the reading was right. Either way, you're the accountant here, it's the intern.
      </HelpHint>
      <Card className="p-0">
        {!docs ? (
          <div className="p-5"><RowSkeleton rows={5} /></div>
        ) : docs.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="font-display text-lg text-ink">Nothing here yet</p>
            <p className="mt-1 text-sm text-faint">Upload your first receipt and the agent will draft it for review.</p>
            <Link to="/upload" className="mt-3 inline-block rounded-full bg-moss px-4 py-2 text-sm font-semibold text-white hover:bg-moss-dark">Upload a document</Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wider text-faint">
                <th className="px-5 py-3 font-medium">Document</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Uploaded</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {[...pending, ...rest].map((d) => (
                <tr key={d.id} className="border-b border-hairline/60 last:border-0 hover:bg-paper/60">
                  <td className="px-5 py-3 font-medium">{d.s3_key.split("/").pop()}</td>
                  <td className="px-5 py-3 text-faint">{d.doc_type.replace(/_/g, " ")}</td>
                  <td className="figure px-5 py-3 text-faint">{shortDate(d.created_at)}</td>
                  <td className="px-5 py-3"><StatusBadge status={d.status} /></td>
                  <td className="px-5 py-3 text-right">
                    {d.status === "needs_review" ? (
                      <Link to={`/review/${d.id}`} className="font-medium text-moss hover:underline">Review →</Link>
                    ) : (
                      <span className="text-faint/50">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
