// CLI for summary:generate npm script.

import { IS_MOCK } from './client';
import { generateSummary } from './generate';

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

  if (command === 'generate') {
    const period = typeof args['period'] === 'string' ? args['period'] : 'YTD';
    console.log(`${mode} Generating executive summary for period: ${period}`);
    const summary = await generateSummary(period);
    console.log(`\n--- Summary (id: ${summary.id}) ---\n`);
    console.log(summary.body);
    console.log(`\n--- End of Summary ---`);
  } else {
    console.error(`Unknown command: ${command ?? '(none)'}. Use 'generate'.`);
    process.exit(1);
  }
}

void main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
