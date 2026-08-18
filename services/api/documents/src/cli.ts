// CLI for document:retrieve npm script — manual testing without a real
// HTTP endpoint yet (issue #26 builds that separately).

import { IS_MOCK, ORG_ID, ACTOR_ID } from './client';
import { retrieveDocumentUrl, isExpired } from './retrieve';
import type { VolunteerRole } from '../../../../lib/rbac';

const VALID_ROLES: VolunteerRole[] = ['data_entry', 'reviewer', 'treasurer', 'leadership'];

function parseArgs(argv: string[]): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  let i = 0;
  while (i < argv.length) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const values: string[] = [];
      i++;
      while (i < argv.length && !argv[i].startsWith('--')) {
        values.push(argv[i++]);
      }
      result[key] = values.length === 1 ? values[0] : values;
    } else {
      i++;
    }
  }
  return result;
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);
  const mode = IS_MOCK ? '[mock mode]' : '[real mode]';

  if (command === 'retrieve') {
    const documentId = typeof args['document-id'] === 'string' ? args['document-id'] : '';
    const role = typeof args['role'] === 'string' ? args['role'] : '';
    if (!documentId) {
      console.error('Missing --document-id.');
      process.exit(1);
      return;
    }
    if (!VALID_ROLES.includes(role as VolunteerRole)) {
      console.error(
        `Missing or invalid --role (got ${JSON.stringify(role)}). This command enforces A4/D1 RBAC ` +
        `(view_raw_document, reviewer/treasurer only) — pass the caller's volunteer role: ${VALID_ROLES.join(', ')}.`,
      );
      process.exit(1);
      return;
    }
    const volunteerId = typeof args['volunteer-id'] === 'string' ? args['volunteer-id'] : ACTOR_ID;
    const subject = { volunteerId, orgId: ORG_ID, role: role as VolunteerRole };
    const bucket = process.env.INGESTION_BUCKET ?? 'fiscus-ingestion-local';
    const region = process.env.AWS_REGION ?? 'us-east-1';

    console.log(`${mode} Retrieving document ${documentId} (role: ${role})...`);
    const result = await retrieveDocumentUrl(subject, documentId, { bucket, region });
    console.log(`\n--- Pre-signed URL (ttl: ${result.ttlSeconds}s, expires: ${result.expiresAt}) ---\n`);
    console.log(result.url);
    console.log(`\nexpired right now? ${isExpired(result)}`);
  } else {
    console.error(`Unknown command: ${command ?? '(none)'}. Use 'retrieve'.`);
    process.exit(1);
  }
}

void main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
