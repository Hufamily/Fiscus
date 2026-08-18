// D3: data retention and lifecycle jobs.

export interface OrganizationRow {
  id: string;
  name: string;
  retention_years: number;
}

export interface DocumentRow {
  id: string;
  org_id: string;
  s3_key: string;
  doc_type: string;
  status: string;
  uploaded_by: string;
  created_at: string;
  [key: string]: unknown;
}

// One purged document, returned by purgeExpiredDocuments() for CLI/logging use.
export interface PurgeResult {
  orgId: string;
  documentId: string;
  s3Key: string;
  retentionYears: number;
  cutoff: string;
}
