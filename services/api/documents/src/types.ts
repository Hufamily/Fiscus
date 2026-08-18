export interface DocumentRow {
  id: string;
  org_id: string;
  s3_key: string;
  doc_type: string;
  status: string;
  uploaded_by: string;
}

// Result of a successful retrieveDocumentUrl() call — never persisted,
// just handed back to the caller (and, eventually, #26's HTTP layer).
export interface RetrieveDocumentResult {
  documentId: string;
  url: string;
  expiresAt: string; // ISO-8601
  ttlSeconds: number;
}
