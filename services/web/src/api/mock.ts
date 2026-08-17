import type { FiscusApi } from "./client";
import type { FiscusDocument, Transaction, Template, Correction, AgentMessage, SearchResult, ReviewSession } from "../types";
import {
  ORG, VOLUNTEERS, DOCUMENTS, TRANSACTIONS, TEMPLATES, LEADERSHIP_SUMMARY,
  ACTIVITY, LEARNED, AGENT_QA,
} from "../mock/data";

const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

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

  async getActivity() { await delay(); return clone(ACTIVITY); },

  async getLearnedCorrections() { await delay(); return clone(LEARNED); },

  async askAgent(question) {
    await delay(500);
    const q = question.toLowerCase();
    const hit = AGENT_QA.find((a) => a.match.some((m) => q.includes(m)));
    const msg: AgentMessage = hit
      ? { role: "agent", text: hit.text, citations: hit.citations }
      : { role: "agent", text: "I can answer questions about spending by category, totals, and what's pending review. Try asking about vet costs, supplies, or total spend." };
    return clone(msg);
  },

  async searchTransactions(query) {
    await delay(420);
    const q = query.toLowerCase().trim();
    if (!q) return [];
    // Mock of B3: score every known transaction + document against the query terms.
    // The real endpoint does cosine similarity over VECTOR(1536) embeddings in CockroachDB.
    const terms = q.split(/\s+/);
    const results: SearchResult[] = [];
    for (const d of docs) {
      const t = txns[d.id];
      const hay = [
        d.s3_key, d.doc_type, t?.category ?? "", t?.txn_date ?? "", d.created_at.slice(0, 7),
        ...(t?.extracted_fields.map((f) => f.value) ?? []),
      ].join(" ").toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (hay.includes(term)) score += 0.42;
        else if (term.length > 3 && hay.includes(term.slice(0, term.length - 1))) score += 0.2;
      }
      // month-name queries ("june") map to txn dates
      const months: Record<string, string> = { january:"-01-", february:"-02-", march:"-03-", april:"-04-", may:"-05-", june:"-06-", july:"-07-", august:"-08-" };
      for (const [name, num] of Object.entries(months)) {
        if (q.includes(name) && (t?.txn_date.includes(num) || d.created_at.includes(num))) score += 0.5;
      }
      if (score > 0.15) {
        results.push({
          transaction_id: t?.id ?? "txn_" + d.id,
          document_id: d.id,
          doc_name: d.s3_key.split("/").pop() ?? d.id,
          doc_type: d.doc_type,
          category: t?.category ?? d.doc_type.replace(/_/g, " "),
          amount_cents: t?.amount_cents ?? 0,
          txn_date: t?.txn_date ?? d.created_at.slice(0, 10),
          snippet: t ? t.extracted_fields.slice(0, 2).map((f) => `${f.label}: ${f.value}`).join(" · ") : "extracted record",
          score: Math.min(0.98, 0.45 + score * 0.35),
        });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 6);
  },

  async getReviewSession() {
    await delay(200);
    const pending = docs.filter((d) => d.status === "needs_review").map((d) => d.id);
    if (pending.length === 0) return null;
    const session: ReviewSession = {
      id: "sess_amy_1",
      volunteer_id: "vol_amy",
      pending_document_ids: pending,
      current_index: 0,
      updated_at: new Date().toISOString(),
    };
    return clone(session);
  },
};
