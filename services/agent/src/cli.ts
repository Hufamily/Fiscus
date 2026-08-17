// CLI for agent:ask npm script.

import { MODULE_ROOT, IS_MOCK } from './client';
import { ask } from './agent';

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
  } else {
    console.error(`Unknown command: ${command ?? '(none)'}. Use 'ask'.`);
    process.exit(1);
  }
}

void main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
