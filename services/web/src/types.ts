// Mirrors the AGENTS.md data model (section 4). This file is the front-end's view of the
// services/api contract. If the charter schema changes, update here first, then the mock.

export type Role = "data_entry" | "reviewer" | "treasurer" | "leadership";

export type DocStatus = "uploaded" | "extracting" | "needs_review" | "approved" | "rejected";
export type TemplateStatus = "pending_review" | "approved";
export type TxnStatus = "pending_review" | "approved" | "rejected";

export interface Organization {
  id: string;
  name: string;
  retention_years: number;
  created_at: string;
}

export interface Volunteer {
  id: string;
  org_id: string;
  role: Role;
  display_name: string;
}

export interface FiscusDocument {
  id: string;
  org_id: string;
  s3_key: string;
  doc_type: string;
  status: DocStatus;
  uploaded_by: string;
  created_at: string;
}

export interface ExtractedField {
  key: string;
  label: string;
  value: string;
  confidence: number; // 0..1, drives the "check this" highlighting
}

export interface Transaction {
  id: string;
  org_id: string;
  document_id: string;
  category: string;
  amount_cents: number;
  currency: string;
  txn_date: string;
  extracted_fields: ExtractedField[];
  status: TxnStatus;
}

export interface Template {
  id: string;
  org_id: string;
  form_type: string;
  status: TemplateStatus;
  field_count: number;
  example_doc_id: string;
}

export interface Correction {
  id: string;
  org_id: string;
  transaction_id: string;
  field: string;
  original_value: string;
  corrected_value: string;
  corrected_by: string;
  created_at: string;
}

// Leadership sees ONLY aggregates (charter section 5: RBAC at the query layer).
export interface CategoryTotal {
  category: string;
  total_cents: number;
  txn_count: number;
}

export interface LeadershipSummary {
  org_id: string;
  period_label: string;
  total_spend_cents: number;
  txn_count: number;
  pending_review_count: number;
  by_category: CategoryTotal[];
  monthly_spend_cents: { month: string; total_cents: number }[];
}

// ---- Added for the fuller layout (activity feed, learned memory, agent chat) ----

export type ActivityAction =
  | "document_uploaded"
  | "fields_extracted"
  | "correction_applied"
  | "transaction_approved"
  | "template_generated"
  | "template_approved";

export interface ActivityEvent {
  id: string;
  org_id: string;
  actor: string;      // display name, "Fiscus Agent" for agent actions
  is_agent: boolean;
  action: ActivityAction;
  detail: string;     // human-readable line
  created_at: string;
}

// A correction the agent has generalized into memory and now auto-applies.
export interface LearnedCorrection {
  id: string;
  org_id: string;
  doc_type: string;
  field: string;
  learned_rule: string;   // e.g. "Vendor 'Riverside Animal Hosp.' -> 'Riverside Animal Hospital'"
  times_applied: number;
  last_applied: string;
}

export interface AgentMessage {
  role: "user" | "agent";
  text: string;
  // aggregate figures the agent cites, shown as chips under an answer
  citations?: string[];
}
