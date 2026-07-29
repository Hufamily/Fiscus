// The single interface the UI codes against. Swapping the mock for the real services/api
// client is a one-line change in index (see ./index.ts). Keep method shapes stable.
import type {
  FiscusDocument,
  Transaction,
  Template,
  Correction,
  LeadershipSummary,
  Organization,
  Volunteer,
} from "../types";

export interface FiscusApi {
  getOrg(): Promise<Organization>;
  getVolunteers(): Promise<Volunteer[]>;

  listDocuments(): Promise<FiscusDocument[]>;
  uploadDocument(file: { name: string; doc_type: string }): Promise<FiscusDocument>;

  getTransactionForDoc(documentId: string): Promise<Transaction | null>;
  applyCorrection(input: {
    transaction_id: string;
    field: string;
    original_value: string;
    corrected_value: string;
  }): Promise<Correction>;
  approveTransaction(transactionId: string): Promise<Transaction>;

  listTemplates(): Promise<Template[]>;
  approveTemplate(templateId: string): Promise<Template>;

  // Aggregate-only endpoint. Backing D2 view; never returns row-level rows.
  getLeadershipSummary(): Promise<LeadershipSummary>;
}
