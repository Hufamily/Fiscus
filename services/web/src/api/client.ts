// The single interface the UI codes against. Swapping the mock for the real services/api
// client is a one-line change in index (see ./index.ts). Keep method shapes stable.
import type {
  FiscusDocument, Transaction, Template, Correction, LeadershipSummary,
  Organization, Volunteer, ActivityEvent, LearnedCorrection, AgentMessage,
  SearchResult, ReviewSession,
} from "../types";

export interface FiscusApi {
  getOrg(): Promise<Organization>;
  getVolunteers(): Promise<Volunteer[]>;

  listDocuments(): Promise<FiscusDocument[]>;
  uploadDocument(file: { name: string; doc_type: string }): Promise<FiscusDocument>;

  getTransactionForDoc(documentId: string): Promise<Transaction | null>;
  applyCorrection(input: {
    transaction_id: string; field: string; original_value: string; corrected_value: string;
  }): Promise<Correction>;
  approveTransaction(transactionId: string): Promise<Transaction>;

  listTemplates(): Promise<Template[]>;
  approveTemplate(templateId: string): Promise<Template>;

  // Aggregate-only endpoint. Backing D2 view; never returns row-level rows.
  getLeadershipSummary(): Promise<LeadershipSummary>;

  // ---- fuller layout ----
  getActivity(): Promise<ActivityEvent[]>;             // audit_log consumer (charter section 6)
  getLearnedCorrections(): Promise<LearnedCorrection[]>; // agent memory made visible
  askAgent(question: string): Promise<AgentMessage>;   // C1-C4 Bedrock agent (mocked)

  // B3 semantic search over transactions (vector index). Mocked with keyword+fuzzy scoring.
  searchTransactions(query: string): Promise<SearchResult[]>;

  // C2 session/task-state persistence: where the volunteer left off.
  getReviewSession(): Promise<ReviewSession | null>;
}
