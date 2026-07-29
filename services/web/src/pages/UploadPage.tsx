import { useState } from "react";
import { api } from "../api";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { useSession } from "../lib/session";
import { can } from "../lib/rbac";

const DOC_TYPES = ["vet_invoice", "supply_receipt", "donation_form", "utility_bill", "other"];

export function UploadPage() {
  const { role } = useSession();
  const allowed = can(role, "upload_documents");
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [justUploaded, setJustUploaded] = useState<string | null>(null);

  if (!allowed) {
    return (
      <Card className="text-slate-600">
        Your role does not have upload access. Switch to <b>Data Entry</b> to upload documents.
      </Card>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fileName) return;
    setBusy(true);
    const doc = await api.uploadDocument({ name: fileName, doc_type: docType });
    setBusy(false);
    setJustUploaded(doc.id);
    setFileName("");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Upload a document</h1>
        <p className="mt-1 text-sm text-slate-500">
          The file is stored in S3; the agent extracts fields via Bedrock and drops a draft transaction into the review queue.
        </p>
      </div>

      <Card>
        <form onSubmit={submit} className="space-y-4">
          <div
            className="grid place-items-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center"
          >
            <p className="text-sm text-slate-500">Drag a receipt or invoice here, or</p>
            <label className="mt-2 cursor-pointer rounded-md bg-white px-3 py-1.5 text-sm font-medium text-brand-dark ring-1 ring-slate-300 hover:bg-slate-50">
              Choose file
              <input
                type="file"
                className="hidden"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
              />
            </label>
            {fileName && <p className="mt-3 text-sm font-medium text-ink">{fileName}</p>}
          </div>

          <div className="flex items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Document type</span>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2"
              >
                {DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            <button
              type="submit"
              disabled={!fileName || busy}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
            >
              {busy ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>
      </Card>

      {justUploaded && (
        <Card className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Uploaded and queued for extraction.</p>
            <p className="text-xs text-slate-500">Document {justUploaded} is now in the review queue.</p>
          </div>
          <StatusBadge status="needs_review" />
        </Card>
      )}
    </div>
  );
}
