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
