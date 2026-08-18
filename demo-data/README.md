# demo-data

Realistic (fully fictional) Green Paws Rescue documents for seeding the live cluster and filming.
Same storyline as the front-end mock data so the UI and database agree on camera.

## Baked-in demo beats
- `vet-invoice-jun.txt` contains a Luhn-valid test card number (4111...) → films the redaction proof (grep the Bedrock prompt, card is masked).
- `petco-receipt-*.txt` vendor reads "PETCO #2214" → the correction story: fix vendor to "Petco" once, show reuse on the second receipt.
- `gala-catering-aug.txt` → the big-ticket low-confidence beat from the demo script.
- Dates span May-Aug 2026 → monthly aggregates on the leadership dashboard look alive.

## Seeding the live cluster (once creds are in .env)
```bash
# embed + store as transactions (B1)
npm run embed:file -- --files demo-data/*.txt ...   # see services/ingestion/embeddings README for exact flags

# teach it the vet-invoice format from two examples (B2)
npm run template:generate -- --form-type vet_invoice --files demo-data/vet-invoice-may.txt demo-data/vet-invoice-jun.txt

# then: search "vet bills in june", agent:ask the three demo questions, summary:generate
```
All documents are invented; card numbers are standard test numbers; no real people or accounts.
