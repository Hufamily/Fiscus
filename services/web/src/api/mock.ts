import type { FiscusApi } from "./client";
import type { FiscusDocument, Transaction, Template, Correction } from "../types";
import { ORG, VOLUNTEERS, DOCUMENTS, TRANSACTIONS, TEMPLATES, LEADERSHIP_SUMMARY } from "../mock/data";

const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// In-memory mutable state so corrections/approvals feel real in the demo.
let docs: FiscusDocument[] = clone(DOCUMENTS);
let txns: Record<string, Transaction> = clone(TRANSACTIONS);
let templates: Template[] = clone(TEMPLATES);
const corrections: Correction[] = [];

export const mockApi: FiscusApi = {
  async getOrg() { await delay(120); return clone(ORG); },
  async getVolunteers() { await delay(120); return clone(VOLUNTEERS); },

  async listDocuments() { await delay(); return clone(docs); },

  async uploadDocument(file) {
    await delay(600);
    const doc: FiscusDocument = {
      id: "doc_" + Math.random().toString(36).slice(2, 7),
      org_id: ORG.id,
      s3_key: `s3://greenpaws/2026/07/${file.name}`,
      doc_type: file.doc_type,
      status: "needs_review",
      uploaded_by: "vol_amy",
      created_at: new Date().toISOString(),
    };
    docs = [doc, ...docs];
    return clone(doc);
  },

  async getTransactionForDoc(documentId) {
    await delay();
    return txns[documentId] ? clone(txns[documentId]) : null;
  },

  async applyCorrection(input) {
    await delay();
    const c: Correction = {
      id: "cor_" + Math.random().toString(36).slice(2, 7),
      org_id: ORG.id,
      transaction_id: input.transaction_id,
      field: input.field,
      original_value: input.original_value,
      corrected_value: input.corrected_value,
      corrected_by: "vol_raj",
      created_at: new Date().toISOString(),
    };
    corrections.push(c);
    // reflect the corrected value back onto the txn's extracted field
    const docId = Object.keys(txns).find((k) => txns[k].id === input.transaction_id);
    if (docId) {
      const f = txns[docId].extracted_fields.find((x) => x.key === input.field);
      if (f) { f.value = input.corrected_value; f.confidence = 1; }
    }
    return clone(c);
  },

  async approveTransaction(transactionId) {
    await delay();
    const docId = Object.keys(txns).find((k) => txns[k].id === transactionId)!;
    txns[docId].status = "approved";
    docs = docs.map((d) => (d.id === docId ? { ...d, status: "approved" } : d));
    return clone(txns[docId]);
  },

  async listTemplates() { await delay(); return clone(templates); },

  async approveTemplate(templateId) {
    await delay();
    templates = templates.map((t) => (t.id === templateId ? { ...t, status: "approved" } : t));
    return clone(templates.find((t) => t.id === templateId)!);
  },

  async getLeadershipSummary() {
    await delay();
    const pending = docs.filter((d) => d.status === "needs_review").length;
    return clone({ ...LEADERSHIP_SUMMARY, pending_review_count: pending });
  },
};
