// CLI for embed:file and search npm scripts.
// File paths in --files resolve relative to the module root.

import path from 'path';
import { MODULE_ROOT, IS_MOCK } from './client';
import { embedFiles } from './embed';
import { runSearch } from './search';

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

function resolveFiles(files: string | string[]): string[] {
  const list = Array.isArray(files) ? files : [files];
  return list.map((f) => (path.isAbsolute(f) ? f : path.resolve(MODULE_ROOT, f)));
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);
  const mode = IS_MOCK ? '[mock mode]' : '[real mode]';

  if (command === 'embed') {
    const files = args['files'];
    const docType = args['doc-type'];
    if (!files || !docType || typeof docType !== 'string') {
      console.error('Usage: embed:file -- --files <f1> <f2> ... --doc-type <type>');
      process.exit(1);
    }
    const resolved = resolveFiles(files);
    console.log(`${mode} Embedding ${resolved.length} file(s) as doc_type="${docType}"`);
    const txns = await embedFiles(resolved, docType);
    console.log(`\nDone. ${txns.length} transaction(s) created.`);

  } else if (command === 'search') {
    const query = args['query'];
    if (!query || typeof query !== 'string') {
      console.error('Usage: search -- --query "<text>"');
      process.exit(1);
    }
    console.log(`${mode} Searching transactions…`);
    await runSearch(query);

  } else {
    console.error(`Unknown command: ${command ?? '(none)'}. Use 'embed' or 'search'.`);
    process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
