import { useState, useRef, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Card } from "../components/Card";
import { useSession } from "../lib/session";
import { can } from "../lib/rbac";

const DOC_TYPES = ["vet_invoice", "supply_receipt", "donation_form", "utility_bill", "event_invoice", "admin_invoice", "other"];
const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"];
const MAX_MB = 15;

type UploadState =
  | { phase: "idle" }
  | { phase: "ready"; file: File }
  | { phase: "uploading"; file: File; pct: number }
  | { phase: "done"; docId: string; name: string }
  | { phase: "error"; message: string };

export function UploadPage() {
  const { role } = useSession();
  const allowed = can(role, "upload_documents");
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!allowed) {
    return (
      <Card className="text-faint">
        Your role doesn't include uploading. Switch the demo role to <b>Data Entry</b> to try it.
      </Card>
    );
  }

  function validate(file: File): string | null {
    if (!ACCEPTED.includes(file.type)) return `That's a ${file.type || "file type"} — Fiscus takes PDFs and photos (JPG/PNG).`;
    if (file.size > MAX_MB * 1024 * 1024) return `That file is ${(file.size / 1048576).toFixed(1)} MB — the limit is ${MAX_MB} MB.`;
    return null;
  }

  function chooseFile(file: File | undefined) {
    if (!file) return;
    const err = validate(file);
    if (err) { setState({ phase: "error", message: err }); return; }
    setState({ phase: "ready", file });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    chooseFile(e.dataTransfer.files?.[0]);
  }

  async function submit() {
    if (state.phase !== "ready") return;
    const file = state.file;
    // Simulated progress; the real client will report actual S3 upload progress.
    setState({ phase: "uploading", file, pct: 0 });
    const timer = setInterval(() => {
      setState((s) => (s.phase === "uploading" ? { ...s, pct: Math.min(s.pct + 14, 90) } : s));
    }, 120);
    try {
      const doc = await api.uploadDocument({ name: file.name, doc_type: docType });
      clearInterval(timer);
      setState({ phase: "done", docId: doc.id, name: file.name });
    } catch {
      clearInterval(timer);
      setState({ phase: "error", message: "Upload failed. Check your connection and try again — the file stays on your device until it succeeds." });
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Add a document</h1>
        <p className="mt-1 text-sm text-faint">
          Receipts, invoices, donation forms — a photo is fine. The agent reads it and files a draft for review.
        </p>
      </div>

      <Card>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`grid place-items-center rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors ${
            dragOver ? "border-moss bg-moss-soft" : "border-hairline bg-paper"
          }`}
        >
          {state.phase === "uploading" ? (
            <div className="w-full max-w-xs">
              <p className="mb-2 truncate text-sm font-medium text-ink">{state.file.name}</p>
              <div className="h-1.5 rounded-full bg-hairline">
                <div className="h-1.5 rounded-full bg-moss transition-all" style={{ width: `${state.pct}%` }} />
              </div>
              <p className="figure mt-2 text-xs text-faint">{state.pct}% · uploading to S3</p>
            </div>
          ) : state.phase === "ready" ? (
            <div>
              <p className="text-sm font-medium text-ink">{state.file.name}</p>
              <p className="figure mt-1 text-xs text-faint">{(state.file.size / 1048576).toFixed(1)} MB</p>
              <button onClick={() => setState({ phase: "idle" })} className="mt-2 text-xs text-faint underline hover:text-ink">choose a different file</button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-faint">{dragOver ? "Drop it here" : "Drag a receipt or invoice here, or"}</p>
              <button
                onClick={() => inputRef.current?.click()}
                className="mt-2 rounded-full border border-hairline bg-surface px-4 py-1.5 text-sm font-medium text-ink hover:border-stone-300"
              >
                Choose a file
              </button>
              <p className="mt-3 font-mono text-[11px] text-faint">PDF · JPG · PNG · up to {MAX_MB} MB</p>
            </div>
          )}
          <input
            ref={inputRef} type="file" className="hidden" accept={ACCEPTED.join(",")}
            onChange={(e) => chooseFile(e.target.files?.[0])}
          />
        </div>

        {state.phase === "error" && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {state.message}
            <button onClick={() => setState({ phase: "idle" })} className="ml-2 underline">try again</button>
          </div>
        )}

        <div className="mt-5 flex items-end justify-between gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-faint">Document type</span>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="rounded-md border border-hairline bg-surface px-3 py-2"
            >
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          <button
            onClick={submit}
            disabled={state.phase !== "ready"}
            className="rounded-full bg-moss px-5 py-2 text-sm font-semibold text-white hover:bg-moss-dark disabled:opacity-40"
          >
            Upload
          </button>
        </div>
      </Card>

      {state.phase === "done" && (
        <Card className="border-moss/30 bg-moss-soft">
          <p className="text-sm font-medium text-ink">In the queue. The agent is reading {state.name}.</p>
          <p className="mt-1 text-sm text-faint">Extracted fields will appear in review shortly.</p>
          <div className="mt-3 flex gap-3">
            <Link to="/review" className="text-sm font-medium text-moss hover:underline">Go to review →</Link>
            <button onClick={() => setState({ phase: "idle" })} className="text-sm text-faint hover:underline">Upload another</button>
          </div>
        </Card>
      )}
    </div>
  );
}
