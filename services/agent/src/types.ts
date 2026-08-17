export interface ConversationTurn {
  question: string;
  answer: string;
}

export interface SessionRow {
  id: string;
  org_id: string;
  volunteer_id: string;
  pending_documents: { conversation?: ConversationTurn[] };
  current_index: number;
  updated_at: string;
}

export interface Citation {
  category: string;
  detail: string;
}

export interface AgentResponse {
  answer: string;
  citations: Citation[];
  session_id: string;
}

export interface AggregateRow {
  category: string;
  status: string;
  total_cents: number;
  count: number;
}

export interface TransactionSummary {
  id: string;
  category: string;
  amount_cents: number;
  txn_date: string;
  status: string;
}
