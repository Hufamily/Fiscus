CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY,
  name STRING NOT NULL,
  retention_years INT NOT NULL DEFAULT 7,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS volunteers (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  role STRING NOT NULL CHECK (role IN ('data_entry', 'reviewer', 'treasurer', 'leadership')),
  display_name STRING NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  s3_key STRING NOT NULL,
  doc_type STRING NOT NULL,
  status STRING NOT NULL CHECK (status IN ('uploaded', 'extracted', 'needs_review')),
  uploaded_by UUID REFERENCES volunteers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, s3_key)
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  document_id UUID NOT NULL UNIQUE REFERENCES documents(id),
  category STRING NOT NULL,
  amount_cents INT8 NOT NULL,
  currency STRING NOT NULL,
  txn_date DATE NOT NULL,
  extracted_fields_json JSONB NOT NULL,
  embedding VECTOR(1536),
  status STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  actor_id UUID NULL REFERENCES volunteers(id),
  action STRING NOT NULL,
  target_table STRING NOT NULL,
  target_id UUID NOT NULL,
  detail_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_org_status_idx ON documents (org_id, status);
CREATE INDEX IF NOT EXISTS transactions_org_date_idx ON transactions (org_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS audit_log_org_created_idx ON audit_log (org_id, created_at DESC);
