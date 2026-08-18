// db/seed.ts — deterministic seed data for the shared CockroachDB dev
// cluster. Fixed UUIDs (not gen_random_uuid()) so re-running this script
// is idempotent and the data is diffable in review, per issue A1.
//
// Requires COCKROACH_DATABASE_URL — this seeds the real shared dev
// cluster, not a per-service mock-db.json fixture (those already exist
// under each service's fixtures/ directory for offline dev).

import pg from 'pg';
import { embed } from '../lib/embeddings';
import { logAction } from '../lib/audit';

const { Client } = pg;

const DB_URL = process.env.COCKROACH_DATABASE_URL ?? process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('COCKROACH_DATABASE_URL is not configured — seed script needs a real cluster to write to.');
  process.exit(1);
}

const SEED_ACTOR = 'seed-script';

const ORGS = [
  { id: '00000000-0000-0000-0000-000000000001', name: 'Demo Nonprofit', retention_years: 7 },
  { id: '00000000-0000-0000-0000-000000000002', name: 'Riverside Animal Rescue', retention_years: 7 },
  { id: '00000000-0000-0000-0000-000000000003', name: 'Neighborhood Food Bank', retention_years: 5 },
] as const;

const VOLUNTEERS = [
  { id: '10000000-0000-0000-0000-000000000001', org_id: ORGS[0].id, role: 'data_entry', display_name: 'Ava Thompson' },
  { id: '10000000-0000-0000-0000-000000000002', org_id: ORGS[0].id, role: 'reviewer', display_name: 'Marcus Chen' },
  { id: '10000000-0000-0000-0000-000000000003', org_id: ORGS[0].id, role: 'treasurer', display_name: 'Priya Natarajan' },
  { id: '10000000-0000-0000-0000-000000000004', org_id: ORGS[0].id, role: 'leadership', display_name: 'David Okafor' },
  { id: '10000000-0000-0000-0000-000000000005', org_id: ORGS[1].id, role: 'data_entry', display_name: 'Sofia Alvarez' },
  { id: '10000000-0000-0000-0000-000000000006', org_id: ORGS[1].id, role: 'reviewer', display_name: 'Liam Fitzgerald' },
  { id: '10000000-0000-0000-0000-000000000007', org_id: ORGS[2].id, role: 'treasurer', display_name: 'Grace Kim' },
  { id: '10000000-0000-0000-0000-000000000008', org_id: ORGS[2].id, role: 'leadership', display_name: 'Noah Bennett' },
] as const;

const TEMPLATES = [
  {
    id: '20000000-0000-0000-0000-000000000001',
    org_id: ORGS[0].id,
    form_type: 'vet_invoice',
    schema_json: JSON.stringify([
      { key: 'invoice_number', label: 'Invoice Number', type: 'string', sample: 'INV-240715' },
      { key: 'total_amount', label: 'Total Amount', type: 'amount', sample: '$244.69' },
      { key: 'vendor_name', label: 'Vendor Name', type: 'string', sample: 'Paws & Claws Veterinary Clinic' },
    ]),
    status: 'approved',
  },
  {
    id: '20000000-0000-0000-0000-000000000002',
    org_id: ORGS[0].id,
    form_type: 'donation_receipt',
    schema_json: JSON.stringify([
      { key: 'receipt_number', label: 'Receipt Number', type: 'string', sample: 'DON-240601' },
      { key: 'donor', label: 'Donor', type: 'string', sample: 'Springfield Area United Nonprofits' },
      { key: 'total_amount', label: 'Total Amount', type: 'amount', sample: '$500.00' },
    ]),
    status: 'pending_review',
  },
  {
    id: '20000000-0000-0000-0000-000000000003',
    org_id: ORGS[1].id,
    form_type: 'supply_receipt',
    schema_json: JSON.stringify([
      { key: 'receipt_number', label: 'Receipt Number', type: 'string', sample: 'RCP-240610' },
      { key: 'vendor', label: 'Vendor', type: 'string', sample: 'Office Depot' },
      { key: 'total_amount', label: 'Total Amount', type: 'amount', sample: '$87.50' },
    ]),
    status: 'approved',
  },
] as const;

const DOCUMENTS = [
  { id: '30000000-0000-0000-0000-000000000001', org_id: ORGS[0].id, s3_key: 's3://fiscus-demo/org1/vet-invoice-1.jpg', doc_type: 'vet_invoice', status: 'approved', uploaded_by: VOLUNTEERS[0].id },
  { id: '30000000-0000-0000-0000-000000000002', org_id: ORGS[0].id, s3_key: 's3://fiscus-demo/org1/donation-receipt-1.jpg', doc_type: 'donation_receipt', status: 'approved', uploaded_by: VOLUNTEERS[0].id },
  { id: '30000000-0000-0000-0000-000000000003', org_id: ORGS[0].id, s3_key: 's3://fiscus-demo/org1/supply-receipt-1.jpg', doc_type: 'supply_receipt', status: 'needs_review', uploaded_by: VOLUNTEERS[0].id },
  { id: '30000000-0000-0000-0000-000000000004', org_id: ORGS[1].id, s3_key: 's3://fiscus-demo/org2/vet-invoice-1.jpg', doc_type: 'vet_invoice', status: 'approved', uploaded_by: VOLUNTEERS[4].id },
  { id: '30000000-0000-0000-0000-000000000005', org_id: ORGS[2].id, s3_key: 's3://fiscus-demo/org3/supply-receipt-1.jpg', doc_type: 'supply_receipt', status: 'approved', uploaded_by: VOLUNTEERS[6].id },
] as const;

const TRANSACTIONS = [
  { id: '40000000-0000-0000-0000-000000000001', org_id: ORGS[0].id, document_id: DOCUMENTS[0].id, category: 'veterinary', amount_cents: 24469, currency: 'USD', txn_date: '2024-07-15', extracted_fields_json: JSON.stringify([{ key: 'vendor', value: 'Paws & Claws Veterinary Clinic' }]), status: 'approved' },
  { id: '40000000-0000-0000-0000-000000000002', org_id: ORGS[0].id, document_id: DOCUMENTS[1].id, category: 'donations', amount_cents: 50000, currency: 'USD', txn_date: '2024-06-01', extracted_fields_json: JSON.stringify([{ key: 'donor', value: 'Springfield Area United Nonprofits' }]), status: 'approved' },
  { id: '40000000-0000-0000-0000-000000000003', org_id: ORGS[0].id, document_id: DOCUMENTS[2].id, category: 'office_supplies', amount_cents: 8750, currency: 'USD', txn_date: '2024-06-10', extracted_fields_json: JSON.stringify([{ key: 'vendor', value: 'Office Depot' }]), status: 'pending_review' },
  { id: '40000000-0000-0000-0000-000000000004', org_id: ORGS[1].id, document_id: DOCUMENTS[3].id, category: 'veterinary', amount_cents: 18900, currency: 'USD', txn_date: '2024-05-22', extracted_fields_json: JSON.stringify([{ key: 'vendor', value: 'Riverside Vet Clinic' }]), status: 'approved' },
  { id: '40000000-0000-0000-0000-000000000005', org_id: ORGS[2].id, document_id: DOCUMENTS[4].id, category: 'office_supplies', amount_cents: 4200, currency: 'USD', txn_date: '2024-05-30', extracted_fields_json: JSON.stringify([{ key: 'vendor', value: 'Staples' }]), status: 'approved' },
] as const;

const CORRECTIONS = [
  { id: '50000000-0000-0000-0000-000000000001', org_id: ORGS[0].id, transaction_id: TRANSACTIONS[0].id, field: 'category', original_value: 'other', corrected_value: 'veterinary', corrected_by: VOLUNTEERS[1].id },
  { id: '50000000-0000-0000-0000-000000000002', org_id: ORGS[0].id, transaction_id: TRANSACTIONS[2].id, field: 'amount_cents', original_value: '8700', corrected_value: '8750', corrected_by: VOLUNTEERS[1].id },
] as const;

async function main(): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  try {
    for (const org of ORGS) {
      await client.query(
        `INSERT INTO organizations (id, name, retention_years) VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET name = $2, retention_years = $3`,
        [org.id, org.name, org.retention_years],
      );
    }
    console.log(`Seeded ${ORGS.length} organizations.`);

    for (const v of VOLUNTEERS) {
      await client.query(
        `INSERT INTO volunteers (id, org_id, role, display_name) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET role = $3, display_name = $4`,
        [v.id, v.org_id, v.role, v.display_name],
      );
    }
    console.log(`Seeded ${VOLUNTEERS.length} volunteers.`);

    for (const t of TEMPLATES) {
      const embedding = await embed(`${t.form_type} ${t.schema_json}`);
      await client.query(
        `INSERT INTO templates (id, org_id, form_type, schema_json, embedding, status) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET schema_json = $4, embedding = $5, status = $6`,
        [t.id, t.org_id, t.form_type, t.schema_json, JSON.stringify(embedding), t.status],
      );
      await logAction(t.org_id, SEED_ACTOR, 'seed_insert', 'templates', t.id, { form_type: t.form_type });
    }
    console.log(`Seeded ${TEMPLATES.length} templates.`);

    for (const d of DOCUMENTS) {
      await client.query(
        `INSERT INTO documents (id, org_id, s3_key, doc_type, status, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET status = $5`,
        [d.id, d.org_id, d.s3_key, d.doc_type, d.status, d.uploaded_by],
      );
    }
    console.log(`Seeded ${DOCUMENTS.length} documents.`);

    for (const t of TRANSACTIONS) {
      const embedding = await embed(`${t.category} ${t.extracted_fields_json}`);
      await client.query(
        `INSERT INTO transactions (id, org_id, document_id, category, amount_cents, currency, txn_date, extracted_fields_json, embedding, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET category = $4, amount_cents = $5, status = $10`,
        [t.id, t.org_id, t.document_id, t.category, t.amount_cents, t.currency, t.txn_date, t.extracted_fields_json, JSON.stringify(embedding), t.status],
      );
      await logAction(t.org_id, SEED_ACTOR, 'seed_insert', 'transactions', t.id, { category: t.category });
    }
    console.log(`Seeded ${TRANSACTIONS.length} transactions.`);

    for (const c of CORRECTIONS) {
      await client.query(
        `INSERT INTO corrections (id, org_id, transaction_id, field, original_value, corrected_value, corrected_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET corrected_value = $6`,
        [c.id, c.org_id, c.transaction_id, c.field, c.original_value, c.corrected_value, c.corrected_by],
      );
      await logAction(c.org_id, c.corrected_by, 'correction_applied', 'corrections', c.id, { field: c.field });
    }
    console.log(`Seeded ${CORRECTIONS.length} corrections.`);

    console.log('Seed complete.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
