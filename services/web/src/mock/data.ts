import type {
  Organization, Volunteer, FiscusDocument, Transaction, Template, LeadershipSummary,
  ActivityEvent, LearnedCorrection,
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

const D = (id: string, key: string, type: string, status: FiscusDocument["status"], by: string, at: string): FiscusDocument =>
  ({ id, org_id: ORG.id, s3_key: `s3://greenpaws/${key}`, doc_type: type, status, uploaded_by: by, created_at: at });

export const DOCUMENTS: FiscusDocument[] = [
  D("doc_1",  "2026/08/vet-invoice-0811.pdf",    "vet_invoice",    "needs_review", "vol_amy", "2026-08-11T15:02:00Z"),
  D("doc_2",  "2026/08/petsmart-receipt-0810.jpg","supply_receipt", "needs_review", "vol_amy", "2026-08-10T18:20:00Z"),
  D("doc_3",  "2026/08/gala-catering-0808.pdf",  "event_invoice",  "needs_review", "vol_amy", "2026-08-08T12:40:00Z"),
  D("doc_4",  "2026/08/coned-bill-0805.pdf",     "utility_bill",   "approved",     "vol_amy", "2026-08-05T09:30:00Z"),
  D("doc_5",  "2026/08/donation-form-0803.pdf",  "donation_form",  "approved",     "vol_amy", "2026-08-03T11:00:00Z"),
  D("doc_6",  "2026/07/vet-invoice-0728.pdf",    "vet_invoice",    "approved",     "vol_amy", "2026-07-28T14:10:00Z"),
  D("doc_7",  "2026/07/petco-receipt-0722.jpg",  "supply_receipt", "approved",     "vol_amy", "2026-07-22T17:05:00Z"),
  D("doc_8",  "2026/07/adoption-fees-0718.pdf",  "donation_form",  "approved",     "vol_raj", "2026-07-18T10:00:00Z"),
  D("doc_9",  "2026/07/vet-invoice-0714.pdf",    "vet_invoice",    "approved",     "vol_amy", "2026-07-14T15:02:00Z"),
  D("doc_10", "2026/07/insurance-0709.pdf",      "admin_invoice",  "approved",     "vol_dana","2026-07-09T11:00:00Z"),
  D("doc_11", "2026/06/coned-bill-0628.pdf",     "utility_bill",   "approved",     "vol_amy", "2026-06-28T09:30:00Z"),
  D("doc_12", "2026/06/vet-invoice-0620.pdf",    "vet_invoice",    "approved",     "vol_amy", "2026-06-20T16:45:00Z"),
  D("doc_13", "2026/06/chewy-order-0612.pdf",    "supply_receipt", "approved",     "vol_amy", "2026-06-12T13:20:00Z"),
  D("doc_14", "2026/06/spring-gala-0605.pdf",    "event_invoice",  "rejected",     "vol_amy", "2026-06-05T19:00:00Z"),
  D("doc_15", "2026/05/vet-invoice-0524.pdf",    "vet_invoice",    "approved",     "vol_amy", "2026-05-24T11:30:00Z"),
];

export const TRANSACTIONS: Record<string, Transaction> = {
  doc_1: {
    id: "txn_1", org_id: ORG.id, document_id: "doc_1", category: "Veterinary",
    amount_cents: 42350, currency: "USD", txn_date: "2026-08-11", status: "pending_review",
    extracted_fields: [
      { key: "vendor", label: "Vendor", value: "Riverside Animal Hospital", confidence: 0.98 },
      { key: "amount", label: "Total Amount", value: "$423.50", confidence: 0.71 },
      { key: "txn_date", label: "Date", value: "2026-08-11", confidence: 0.95 },
      { key: "category", label: "Category", value: "Veterinary", confidence: 0.92 },
      { key: "card_last4", label: "Card (last 4)", value: "•••• 4021", confidence: 0.99 },
    ],
  },
  doc_2: {
    id: "txn_2", org_id: ORG.id, document_id: "doc_2", category: "Supplies",
    amount_cents: 8799, currency: "USD", txn_date: "2026-08-10", status: "pending_review",
    extracted_fields: [
      { key: "vendor", label: "Vendor", value: "PetSmart #1108", confidence: 0.64 },
      { key: "amount", label: "Total Amount", value: "$87.99", confidence: 0.88 },
      { key: "txn_date", label: "Date", value: "2026-08-10", confidence: 0.9 },
      { key: "category", label: "Category", value: "Supplies", confidence: 0.85 },
    ],
  },
  doc_3: {
    id: "txn_3", org_id: ORG.id, document_id: "doc_3", category: "Events",
    amount_cents: 168000, currency: "USD", txn_date: "2026-08-08", status: "pending_review",
    extracted_fields: [
      { key: "vendor", label: "Vendor", value: "Harvest Table Catering", confidence: 0.95 },
      { key: "amount", label: "Total Amount", value: "$1,680.00", confidence: 0.58 },
      { key: "txn_date", label: "Date", value: "2026-08-08", confidence: 0.93 },
      { key: "category", label: "Category", value: "Events", confidence: 0.79 },
      { key: "notes", label: "Notes", value: "Fall fundraiser gala — deposit", confidence: 0.66 },
    ],
  },
};

export const TEMPLATES: Template[] = [
  { id: "tpl_1", org_id: ORG.id, form_type: "vet_invoice",    status: "approved",       field_count: 6, example_doc_id: "doc_9" },
  { id: "tpl_2", org_id: ORG.id, form_type: "supply_receipt", status: "approved",       field_count: 5, example_doc_id: "doc_7" },
  { id: "tpl_3", org_id: ORG.id, form_type: "donation_form",  status: "approved",       field_count: 7, example_doc_id: "doc_5" },
  { id: "tpl_4", org_id: ORG.id, form_type: "event_invoice",  status: "pending_review", field_count: 6, example_doc_id: "doc_3" },
  { id: "tpl_5", org_id: ORG.id, form_type: "utility_bill",   status: "approved",       field_count: 4, example_doc_id: "doc_11" },
];

export const LEADERSHIP_SUMMARY: LeadershipSummary = {
  org_id: ORG.id,
  period_label: "YTD 2026",
  total_spend_cents: 1284500,
  txn_count: 142,
  pending_review_count: 3,
  by_category: [
    { category: "Veterinary", total_cents: 612300, txn_count: 48 },
    { category: "Supplies",   total_cents: 284100, txn_count: 51 },
    { category: "Facilities", total_cents: 201400, txn_count: 22 },
    { category: "Events",     total_cents: 118700, txn_count: 14 },
    { category: "Admin",      total_cents: 68000,  txn_count: 7 },
  ],
  monthly_spend_cents: [
    { month: "Mar", total_cents: 168500 },
    { month: "Apr", total_cents: 201000 },
    { month: "May", total_cents: 233000 },
    { month: "Jun", total_cents: 289000 },
    { month: "Jul", total_cents: 251000 },
    { month: "Aug", total_cents: 142000 },
  ],
};

export const ACTIVITY: ActivityEvent[] = [
  { id: "act_1",  org_id: ORG.id, actor: "Fiscus Agent", is_agent: true,  action: "fields_extracted",     detail: "Extracted 5 fields from vet-invoice-0811.pdf — 2 learned rules applied", created_at: "2026-08-11T15:03:00Z" },
  { id: "act_2",  org_id: ORG.id, actor: "Amy Chen",     is_agent: false, action: "document_uploaded",    detail: "Uploaded vet-invoice-0811.pdf", created_at: "2026-08-11T15:02:00Z" },
  { id: "act_3",  org_id: ORG.id, actor: "Fiscus Agent", is_agent: true,  action: "fields_extracted",     detail: "Extracted 4 fields from petsmart-receipt-0810.jpg — vendor uncertain (64%)", created_at: "2026-08-10T18:21:00Z" },
  { id: "act_4",  org_id: ORG.id, actor: "Fiscus Agent", is_agent: true,  action: "template_generated",   detail: "Proposed an event_invoice template from gala-catering-0808.pdf", created_at: "2026-08-08T12:42:00Z" },
  { id: "act_5",  org_id: ORG.id, actor: "Raj Patel",    is_agent: false, action: "transaction_approved", detail: "Approved coned-bill-0805.pdf ($214.60)", created_at: "2026-08-05T10:15:00Z" },
  { id: "act_6",  org_id: ORG.id, actor: "Dana Okoro",   is_agent: false, action: "transaction_approved", detail: "Approved donation-form-0803.pdf ($250.00)", created_at: "2026-08-03T11:30:00Z" },
  { id: "act_7",  org_id: ORG.id, actor: "Raj Patel",    is_agent: false, action: "correction_applied",   detail: "Corrected Vendor on vet-invoice-0728.pdf ('Riverside Animal Hosp.' → 'Riverside Animal Hospital')", created_at: "2026-07-28T14:30:00Z" },
  { id: "act_8",  org_id: ORG.id, actor: "Fiscus Agent", is_agent: true,  action: "correction_applied",   detail: "Auto-applied learned vendor rule to petco-receipt-0722.jpg", created_at: "2026-07-22T17:06:00Z" },
  { id: "act_9",  org_id: ORG.id, actor: "Dana Okoro",   is_agent: false, action: "template_approved",    detail: "Approved the donation_form template (7 fields)", created_at: "2026-07-18T10:20:00Z" },
  { id: "act_10", org_id: ORG.id, actor: "Fiscus Agent", is_agent: true,  action: "fields_extracted",     detail: "Extracted 6 fields from insurance-0709.pdf", created_at: "2026-07-09T11:02:00Z" },
];

export const LEARNED: LearnedCorrection[] = [
  { id: "lc_1", org_id: ORG.id, doc_type: "supply_receipt", field: "vendor",   learned_rule: "Store-numbered vendors normalize to brand ('Petco #2214' → 'Petco')", times_applied: 9,  last_applied: "2026-08-10T18:21:00Z" },
  { id: "lc_2", org_id: ORG.id, doc_type: "vet_invoice",    field: "vendor",   learned_rule: "'Riverside Animal Hosp.' → 'Riverside Animal Hospital'", times_applied: 11, last_applied: "2026-08-11T15:03:00Z" },
  { id: "lc_3", org_id: ORG.id, doc_type: "vet_invoice",    field: "category", learned_rule: "Riverside line items default to category 'Veterinary'", times_applied: 14, last_applied: "2026-08-11T15:03:00Z" },
  { id: "lc_4", org_id: ORG.id, doc_type: "utility_bill",   field: "category", learned_rule: "ConEd statements → category 'Facilities'", times_applied: 5,  last_applied: "2026-08-05T09:31:00Z" },
];

export const AGENT_QA: { match: string[]; text: string; citations?: string[] }[] = [
  { match: ["vet", "veterinary"], text: "You've spent $6,123.00 on Veterinary so far this year across 48 transactions — your largest category at ~48% of total spend. Riverside Animal Hospital is the main vendor.", citations: ["Veterinary: $6,123.00", "48 transactions", "YTD 2026"] },
  { match: ["supplies", "supply"], text: "Supplies total $2,841.00 across 51 transactions this year, mostly recurring Petco and Chewy purchases.", citations: ["Supplies: $2,841.00", "51 transactions"] },
  { match: ["total", "spend", "budget"], text: "Total spend YTD is $12,845.00 across 142 transactions. Three documents are still pending review, including a $1,680 gala catering deposit.", citations: ["Total: $12,845.00", "142 transactions", "3 pending"] },
  { match: ["pending", "review", "waiting"], text: "Three documents are waiting for review: a vet invoice ($423.50), a PetSmart receipt ($87.99), and the gala catering deposit ($1,680.00 — amount confidence is low, worth a close look).", citations: ["3 pending review"] },
  { match: ["gala", "event", "catering", "fundraiser"], text: "Events spend is $1,187.00 YTD. The pending gala catering deposit ($1,680.00) would make the fall fundraiser your largest event expense this year.", citations: ["Events: $1,187.00", "1 pending: $1,680.00"] },
  { match: ["learned", "memory", "corrections"], text: "I'm carrying 4 learned rules for this org — vendor normalizations and category defaults from your reviewers' corrections. They've been auto-applied 39 times.", citations: ["4 learned rules", "39 auto-applies"] },
];
