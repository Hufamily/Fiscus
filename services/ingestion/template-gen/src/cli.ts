// CLI entry point for template:generate and template:approve npm scripts.
// Paths in --files are resolved relative to the module root (not process CWD).

import path from 'path';
import { MODULE_ROOT, IS_MOCK } from './client';
import { generateTemplate } from './generate';
import { approveTemplate } from './approve';

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

  if (command === 'generate') {
    const formType = args['form-type'];
    const files = args['files'];
    if (!formType || typeof formType !== 'string') {
      console.error('Usage: template:generate -- --form-type <name> --files <file1> <file2> ...');
      process.exit(1);
    }
    if (!files || (Array.isArray(files) && files.length === 0)) {
      console.error('Error: --files requires at least 2 paths');
      process.exit(1);
    }

    const resolvedFiles = resolveFiles(files);
    console.log(`${mode} Generating template for form type: ${formType}`);
    console.log(`Files: ${resolvedFiles.join(', ')}`);

    const template = await generateTemplate(formType, resolvedFiles);

    console.log(`\nTemplate created: ${template.id}`);
    console.log(`Status: ${template.status}`);
    console.log('\nschema_json:');
    console.log(JSON.stringify(template.schema_json, null, 2));
  } else if (command === 'approve') {
    const id = args['id'];
    if (!id || typeof id !== 'string') {
      console.error('Usage: template:approve -- --id <template_id>');
      process.exit(1);
    }

    console.log(`${mode} Approving template: ${id}`);
    const updated = await approveTemplate(id);
    if (updated) {
      console.log(`Template ${id} approved. Status: ${updated.status}`);
    }
  } else {
    console.error(`Unknown command: ${command ?? '(none)'}. Use 'generate' or 'approve'.`);
    process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
