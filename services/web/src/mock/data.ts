import type {
  Organization, Volunteer, FiscusDocument, Transaction, Template, LeadershipSummary,
} from "../types";

export const ORG: Organization = {
  id: "org_greenpaws",
  name: "Green Paws Rescue",
  retention_years: 7,
  created_at: "2021-03-01T00:00:00Z",
};

export const VOLUNTEERS: Volunteer[] = [
  { id: "vol_amy", org_id: ORG.id, role: "data_entry", display_name: "Amy Chen" },
  { id: "vol_raj", org_id: ORG.id, role: "reviewer", display_name: "Raj Patel" },
  { id: "vol_dana", org_id: ORG.id, role: "treasurer", display_name: "Dana Okoro" },
  { id: "vol_pat", org_id: ORG.id, role: "leadership", display_name: "Pat Rivera" },
];

export const DOCUMENTS: FiscusDocument[] = [
  { id: "doc_1", org_id: ORG.id, s3_key: "s3://greenpaws/2026/07/vet-invoice-0714.pdf", doc_type: "vet_invoice", status: "needs_review", uploaded_by: "vol_amy", created_at: "2026-07-14T15:02:00Z" },
  { id: "doc_2", org_id: ORG.id, s3_key: "s3://greenpaws/2026/07/petco-receipt-0712.jpg", doc_type: "supply_receipt", status: "needs_review", uploaded_by: "vol_amy", created_at: "2026-07-12T18:20:00Z" },
  { id: "doc_3", org_id: ORG.id, s3_key: "s3://greenpaws/2026/07/donation-form-0709.pdf", doc_type: "donation_form", status: "approved", uploaded_by: "vol_amy", created_at: "2026-07-09T11:00:00Z" },
  { id: "doc_4", org_id: ORG.id, s3_key: "s3://greenpaws/2026/06/utility-bill-0628.pdf", doc_type: "utility_bill", status: "approved", uploaded_by: "vol_amy", created_at: "2026-06-28T09:30:00Z" },
];

export const TRANSACTIONS: Record<string, Transaction> = {
  doc_1: {
    id: "txn_1", org_id: ORG.id, document_id: "doc_1", category: "Veterinary",
    amount_cents: 42350, currency: "USD", txn_date: "2026-07-14", status: "pending_review",
    extracted_fields: [
      { key: "vendor", label: "Vendor", value: "Riverside Animal Hospital", confidence: 0.98 },
      { key: "amount", label: "Total Amount", value: "$423.50", confidence: 0.71 },
      { key: "txn_date", label: "Date", value: "2026-07-14", confidence: 0.95 },
      { key: "category", label: "Category", value: "Veterinary", confidence: 0.88 },
      { key: "card_last4", label: "Card (last 4)", value: "•••• 4021", confidence: 0.99 },
    ],
  },
  doc_2: {
    id: "txn_2", org_id: ORG.id, document_id: "doc_2", category: "Supplies",
    amount_cents: 8799, currency: "USD", txn_date: "2026-07-12", status: "pending_review",
    extracted_fields: [
      { key: "vendor", label: "Vendor", value: "Petco #2214", confidence: 0.93 },
      { key: "amount", label: "Total Amount", value: "$87.99", confidence: 0.64 },
      { key: "txn_date", label: "Date", value: "2026-07-12", confidence: 0.9 },
      { key: "category", label: "Category", value: "Supplies", confidence: 0.82 },
    ],
  },
};

export const TEMPLATES: Template[] = [
  { id: "tpl_1", org_id: ORG.id, form_type: "vet_invoice", status: "approved", field_count: 6, example_doc_id: "doc_1" },
  { id: "tpl_2", org_id: ORG.id, form_type: "supply_receipt", status: "approved", field_count: 5, example_doc_id: "doc_2" },
  { id: "tpl_3", org_id: ORG.id, form_type: "donation_form", status: "pending_review", field_count: 7, example_doc_id: "doc_3" },
];

export const LEADERSHIP_SUMMARY: LeadershipSummary = {
  org_id: ORG.id,
  period_label: "YTD 2026",
  total_spend_cents: 1284500,
  txn_count: 142,
  pending_review_count: 2,
  by_category: [
    { category: "Veterinary", total_cents: 612300, txn_count: 48 },
    { category: "Supplies", total_cents: 284100, txn_count: 51 },
    { category: "Facilities", total_cents: 201400, txn_count: 22 },
    { category: "Events", total_cents: 118700, txn_count: 14 },
    { category: "Admin", total_cents: 68000, txn_count: 7 },
  ],
  monthly_spend_cents: [
    { month: "Feb", total_cents: 142000 },
    { month: "Mar", total_cents: 168500 },
    { month: "Apr", total_cents: 201000 },
    { month: "May", total_cents: 233000 },
    { month: "Jun", total_cents: 289000 },
    { month: "Jul", total_cents: 251000 },
  ],
};

// ---- Added for the fuller layout ----
import type { ActivityEvent, LearnedCorrection } from "../types";

export const ACTIVITY: ActivityEvent[] = [
  { id: "act_1", org_id: ORG.id, actor: "Fiscus Agent", is_agent: true,  action: "fields_extracted",     detail: "Extracted 5 fields from vet-invoice-0714.pdf", created_at: "2026-07-14T15:03:00Z" },
  { id: "act_2", org_id: ORG.id, actor: "Amy Chen",     is_agent: false, action: "document_uploaded",    detail: "Uploaded vet-invoice-0714.pdf", created_at: "2026-07-14T15:02:00Z" },
  { id: "act_3", org_id: ORG.id, actor: "Raj Patel",    is_agent: false, action: "correction_applied",   detail: "Corrected Total Amount on txn_2 ($8.799 -> $87.99)", created_at: "2026-07-13T10:20:00Z" },
  { id: "act_4", org_id: ORG.id, actor: "Fiscus Agent", is_agent: true,  action: "template_generated",   detail: "Generated a donation_form template from donation-form-0709.pdf", created_at: "2026-07-09T11:05:00Z" },
  { id: "act_5", org_id: ORG.id, actor: "Dana Okoro",   is_agent: false, action: "transaction_approved", detail: "Approved donation-form-0709.pdf ($250.00)", created_at: "2026-07-09T11:10:00Z" },
  { id: "act_6", org_id: ORG.id, actor: "Fiscus Agent", is_agent: true,  action: "correction_applied",   detail: "Auto-applied a learned vendor fix on a new Petco receipt", created_at: "2026-07-12T18:21:00Z" },
];

export const LEARNED: LearnedCorrection[] = [
  { id: "lc_1", org_id: ORG.id, doc_type: "supply_receipt", field: "vendor",   learned_rule: "'Petco #2214' is recorded as vendor 'Petco'", times_applied: 6, last_applied: "2026-07-12T18:21:00Z" },
  { id: "lc_2", org_id: ORG.id, doc_type: "vet_invoice",    field: "category", learned_rule: "Line items from Riverside Animal Hospital -> category 'Veterinary'", times_applied: 11, last_applied: "2026-07-14T15:03:00Z" },
  { id: "lc_3", org_id: ORG.id, doc_type: "utility_bill",   field: "category", learned_rule: "ConEd statements -> category 'Facilities'", times_applied: 4, last_applied: "2026-06-28T09:31:00Z" },
];

// Canned agent answers (keyword-matched) standing in for the C1-C4 Bedrock agent.
export const AGENT_QA: { match: string[]; text: string; citations?: string[] }[] = [
  { match: ["vet", "veterinary"], text: "You've spent $6,123.00 on Veterinary so far this year across 48 transactions. That's your largest category, about 48% of total spend.", citations: ["Veterinary: $6,123.00", "48 transactions", "YTD 2026"] },
  { match: ["supplies", "supply"], text: "Supplies total $2,841.00 across 51 transactions this year. Most of it is recurring Petco purchases.", citations: ["Supplies: $2,841.00", "51 transactions"] },
  { match: ["total", "spend", "budget"], text: "Total spend YTD is $12,845.00 across 142 transactions. Two documents are still pending review.", citations: ["Total: $12,845.00", "142 transactions", "2 pending"] },
  { match: ["pending", "review", "waiting"], text: "There are 2 documents waiting for review: vet-invoice-0714.pdf and petco-receipt-0712.jpg.", citations: ["2 pending review"] },
];
