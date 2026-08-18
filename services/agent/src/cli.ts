// CLI for agent:ask npm script.

import { MODULE_ROOT, IS_MOCK, ORG_ID, VOLUNTEER_ID } from './client';
import { ask } from './agent';
import { resumeOpenBatch, startBatch, advanceBatch } from './batch-session';

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

  if (command === 'ask') {
    const question = args['question'];
    const sessionId = typeof args['session'] === 'string' ? args['session'] : undefined;
    if (!question || typeof question !== 'string') {
      console.error('Usage: agent:ask -- --question "<text>" [--session <session_id>]');
      process.exit(1);
    }
    console.log(`${mode} Asking: ${question}`);
    if (sessionId) console.log(`Resuming session: ${sessionId}`);
    const response = await ask(question, sessionId);
    console.log(JSON.stringify(response, null, 2));
  } else if (command === 'batch-resume') {
    // C2: the "on login, resume rather than starting fresh" entry point.
    const orgId = typeof args['org-id'] === 'string' ? args['org-id'] : ORG_ID;
    const volunteerId = typeof args['volunteer-id'] === 'string' ? args['volunteer-id'] : VOLUNTEER_ID;
    const resumed = await resumeOpenBatch(orgId, volunteerId);
    if (!resumed) {
      console.log(`${mode} No open batch session for ${volunteerId}.`);
    } else {
      const { session, nextDocumentId } = resumed;
      console.log(
        `${mode} Resuming session ${session.id} at document ` +
          `${session.current_index + 1}/${session.batch_document_ids.length}: ${nextDocumentId}`,
      );
    }
  } else if (command === 'batch-start') {
    const orgId = typeof args['org-id'] === 'string' ? args['org-id'] : ORG_ID;
    const volunteerId = typeof args['volunteer-id'] === 'string' ? args['volunteer-id'] : VOLUNTEER_ID;
    const docsArg = args['documents'];
    const documentIds = Array.isArray(docsArg) ? docsArg : typeof docsArg === 'string' ? [docsArg] : [];
    if (documentIds.length === 0) {
      console.error('Usage: batch-start --documents <id> [<id> ...] [--org-id <id>] [--volunteer-id <id>]');
      process.exit(1);
      return;
    }
    const session = await startBatch(documentIds, orgId, volunteerId);
    console.log(`${mode} Started batch session ${session.id} with ${documentIds.length} document(s).`);
  } else if (command === 'batch-advance') {
    const sessionId = typeof args['session'] === 'string' ? args['session'] : undefined;
    if (!sessionId) {
      console.error('Usage: batch-advance --session <session_id>');
      process.exit(1);
      return;
    }
    const session = await advanceBatch(sessionId);
    console.log(`${mode} Session ${session.id} now at index ${session.current_index} (${session.batch_status}).`);
  } else {
    console.error(`Unknown command: ${command ?? '(none)'}. Use 'ask', 'batch-start', 'batch-resume', or 'batch-advance'.`);
    process.exit(1);
  }
}

void main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
