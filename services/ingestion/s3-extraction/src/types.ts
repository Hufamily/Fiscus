export interface DocumentIdentity {
  orgId: string;
  documentId: string;
  s3Key: string;
}

export interface LineItem {
  description: string;
  quantity?: number;
  amountCents: number;
}

// The JSON shape Bedrock is instructed to return. See extract.ts's INSTRUCTION.
export interface ExtractionResult {
  vendor: string;
  transactionDate: string; // YYYY-MM-DD
  amountCents: number;
  currency: string;
  lineItems: LineItem[];
  category?: string;
}

export type ContentType = 'application/pdf' | 'image/jpeg' | 'image/png';

export interface CreateUploadRequest {
  orgId: string;
  volunteerId: string;
  contentType: ContentType;
  sizeBytes: number;
}

export interface CreateUploadResult {
  documentId: string;
  key: string;
  uploadUrl: string;
}
