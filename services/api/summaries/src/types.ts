export interface SummaryRow {
  id: string;
  org_id: string;
  period_label: string;
  body: string;
  created_at: string;
}

export interface AggregateRow {
  category: string;
  status: string;
  total_cents: number;
  count: number;
}
