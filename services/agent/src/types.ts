export interface ConversationTurn {
  question: string;
  answer: string;
}

// C2: batch/document-review resume state machine.
//   idle        -- no batch in progress for this org/volunteer
//   in_progress -- batch_document_ids[current_index] is the doc to work on next
//   completed   -- current_index has walked past the end of batch_document_ids
export type BatchStatus = 'idle' | 'in_progress' | 'completed';

export interface SessionRow {
  id: string;
  org_id: string;
  volunteer_id: string;
  // C1's Q&A conversation history -- despite the column name, this is NOT a
  // document queue. See batch_document_ids below for the actual batch-resume
  // state (added by 006_c2_batch_resume.sql), which is a disjoint concern
  // living on the same row.
  pending_documents: { conversation?: ConversationTurn[] };
  // Pointer into batch_document_ids. Pre-existed 006 but was unused (always
  // 0) until C2 gave it a real meaning.
  current_index: number;
  // C2: ordered queue of document IDs for the volunteer's current batch.
  batch_document_ids: string[];
  batch_status: BatchStatus;
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
