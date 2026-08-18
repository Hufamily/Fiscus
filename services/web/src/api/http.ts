/*
 * PR-description draft — endpoint mapping for the services/api HTTP layer (not yet built).
 *
 * CONFIRMED / directly derivable from existing CLI code:
 *   POST /api/agent/ask  { question: string } → AgentMessage
 *     The Bedrock Q&A flow exists in services/api/summaries (C1 architecture); this
 *     endpoint is the natural HTTP surface for it.
 *   GET  /api/summary?period=YTD → LeadershipSummary
 *     ⚠ SHAPE MISMATCH: CLI (services/api/summaries/src/cli.ts) outputs
 *     SummaryRow { id, org_id, period_label, body: TEXT, created_at }. The frontend
 *     expects a structured LeadershipSummary with numeric fields (total_spend_cents,
 *     by_category[], monthly_spend_cents[]). The real endpoint will need either:
 *     (a) a separate /api/aggregate endpoint for the structured breakdown, plus
 *         /api/summary?period=YTD for the prose body only, or
 *     (b) the server to run the aggregate query and reshape the response before returning.
 *     Filed as a known gap — whoever builds the HTTP router here should reconcile this.
 *
 * GUESSED from the FiscusApi interface + AGENTS.md §4 schema (no HTTP server exists yet):
 *   GET  /api/org                        → Organization
 *   GET  /api/volunteers                 → Volunteer[]
 *   GET  /api/documents                  → FiscusDocument[]
 *   POST /api/documents  { name, doc_type } → FiscusDocument
 *   GET  /api/documents/:id/transaction  → Transaction  (204 = not found / not yet extracted)
 *   POST /api/corrections  { transaction_id, field, original_value, corrected_value } → Correction
 *   POST /api/transactions/:id/approve   → Transaction
 *   GET  /api/templates                  → Template[]
 *   POST /api/templates/:id/approve      → Template
 *   GET  /api/activity                   → ActivityEvent[]
 *   GET  /api/corrections/learned        → LearnedCorrection[]
 *   GET  /api/search?q=…                 → SearchResult[]  (B3 vector endpoint, not yet built)
 *   GET  /api/session                    → ReviewSession   (204 = no active session)
 *     ⚠ GUESSED: assumes the caller's volunteer identity is carried by a JWT/session cookie
 *     that the API reads server-side. The mock hardcodes "vol_amy". The real endpoint
 *     needs auth context to look up the right session row.
 */

import type { FiscusApi } from "./client";
import { mockApi } from "./mock";
import { setFallbackActive } from "./fallbackState";
import { currentVolunteerId } from "./actorState";
import type {
  FiscusDocument, Transaction, Template, Correction, LeadershipSummary,
  Organization, Volunteer, ActivityEvent, LearnedCorrection, AgentMessage,
  SearchResult, ReviewSession,
} from "../types";

// Carries the demo actor identity (see actorState.ts) so services/api's
// requireCapability() middleware has someone to check the request against.
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "x-fiscus-volunteer-id": currentVolunteerId(), ...extra };
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function maybeNull<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

function fallback<T>(live: () => Promise<T>, mock: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      return await live();
    } catch {
      setFallbackActive(true);
      return mock();
    }
  };
}

function fallback1<A, T>(
  live: (a: A) => Promise<T>,
  mock: (a: A) => Promise<T>,
): (a: A) => Promise<T> {
  return async (a: A) => {
    try {
      return await live(a);
    } catch {
      setFallbackActive(true);
      return mock(a);
    }
  };
}

export function createHttpApi(base: string): FiscusApi {
  const b = base.replace(/\/$/, "");

  return {
    getOrg: fallback<Organization>(
      () => get(`${b}/org`),
      () => mockApi.getOrg(),
    ),

    getVolunteers: fallback<Volunteer[]>(
      () => get(`${b}/volunteers`),
      () => mockApi.getVolunteers(),
    ),

    listDocuments: fallback<FiscusDocument[]>(
      () => get(`${b}/documents`),
      () => mockApi.listDocuments(),
    ),

    uploadDocument: fallback1<{ name: string; doc_type: string }, FiscusDocument>(
      (file) => post(`${b}/documents`, file),
      (file) => mockApi.uploadDocument(file),
    ),

    getTransactionForDoc: fallback1<string, Transaction | null>(
      (id) => maybeNull(`${b}/documents/${id}/transaction`),
      (id) => mockApi.getTransactionForDoc(id),
    ),

    applyCorrection: fallback1<
      { transaction_id: string; field: string; original_value: string; corrected_value: string },
      Correction
    >(
      (input) => post(`${b}/corrections`, input),
      (input) => mockApi.applyCorrection(input),
    ),

    approveTransaction: fallback1<string, Transaction>(
      (id) => post(`${b}/transactions/${id}/approve`, {}),
      (id) => mockApi.approveTransaction(id),
    ),

    listTemplates: fallback<Template[]>(
      () => get(`${b}/templates`),
      () => mockApi.listTemplates(),
    ),

    approveTemplate: fallback1<string, Template>(
      (id) => post(`${b}/templates/${id}/approve`, {}),
      (id) => mockApi.approveTemplate(id),
    ),

    getLeadershipSummary: fallback<LeadershipSummary>(
      () => get(`${b}/summary?period=YTD`),
      () => mockApi.getLeadershipSummary(),
    ),

    getActivity: fallback<ActivityEvent[]>(
      () => get(`${b}/activity`),
      () => mockApi.getActivity(),
    ),

    getLearnedCorrections: fallback<LearnedCorrection[]>(
      () => get(`${b}/corrections/learned`),
      () => mockApi.getLearnedCorrections(),
    ),

    askAgent: fallback1<string, AgentMessage>(
      (question) => post(`${b}/agent/ask`, { question }),
      (question) => mockApi.askAgent(question),
    ),

    searchTransactions: fallback1<string, SearchResult[]>(
      (query) => get(`${b}/search?q=${encodeURIComponent(query)}`),
      (query) => mockApi.searchTransactions(query),
    ),

    getReviewSession: fallback<ReviewSession | null>(
      () => maybeNull(`${b}/session`),
      () => mockApi.getReviewSession(),
    ),
  };
}
