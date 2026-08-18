import type { Role } from "../types";

// A UI-side mirror of the charter's query-layer RBAC (section 5). The real enforcement
// lives in services/api / D1 (RBAC at the query layer) — this only decides what the UI
// offers, so a leadership user never even sees a control that would issue a row-level query.
export type Capability =
  | "upload_documents"
  | "review_extractions"
  | "apply_corrections"
  | "approve_templates"
  | "view_row_level_transactions"
  | "view_aggregate_reports"
  | "view_raw_document";

const MATRIX: Record<Role, Capability[]> = {
  data_entry: ["upload_documents", "review_extractions", "apply_corrections", "view_row_level_transactions"],
  reviewer: ["review_extractions", "apply_corrections", "approve_templates", "view_row_level_transactions", "view_raw_document"],
  treasurer: ["review_extractions", "approve_templates", "view_row_level_transactions", "view_aggregate_reports", "view_raw_document"],
  leadership: ["view_aggregate_reports"], // aggregate-only, per charter
};

export function can(role: Role, cap: Capability): boolean {
  return MATRIX[role].includes(cap);
}

export const ROLE_LABELS: Record<Role, string> = {
  data_entry: "Data Entry",
  reviewer: "Reviewer",
  treasurer: "Treasurer",
  leadership: "Leadership",
};
