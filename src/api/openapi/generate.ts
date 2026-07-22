import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { buildOpenApiDocument } from './document';

/**
 * Writes (or verifies) `swagger.yaml` from the zod schemas.
 *
 *   npm run openapi:generate   # rewrite swagger.yaml
 *   npm run openapi:check      # fail if swagger.yaml is stale (used by CI)
 */

export const SPEC_PATH = path.resolve(__dirname, '../../../swagger.yaml');

const BANNER = [
  '# GENERATED FILE — DO NOT EDIT BY HAND.',
  '#',
  '# Produced from the zod request schemas in src/api/schemas by',
  '#   npm run openapi:generate',
  '#',
  '# CI runs `npm run openapi:check`, which fails if this file is out of sync with',
  '# the code, so request validation and these docs cannot silently diverge.',
  '',
].join('\n');

export function renderSpec(): string {
  const doc = buildOpenApiDocument();
  const body = yaml.dump(doc, { noRefs: true, lineWidth: 100, sortKeys: false });
  return `${BANNER}${body}`;
}

function main() {
  const check = process.argv.includes('--check');
  const rendered = renderSpec();

  if (!check) {
    fs.writeFileSync(SPEC_PATH, rendered, 'utf8');
    const doc = buildOpenApiDocument();
    const count = Object.values(doc.paths ?? {}).reduce(
      (n, item) => n + Object.keys(item as object).filter((k) => k !== 'parameters').length,
      0,
    );
    console.log(`✅ wrote ${path.relative(process.cwd(), SPEC_PATH)} — ${Object.keys(doc.paths ?? {}).length} paths, ${count} operations`);
    return;
  }

  if (!fs.existsSync(SPEC_PATH)) {
    console.error('❌ swagger.yaml is missing. Run: npm run openapi:generate');
    process.exit(1);
  }
  const onDisk = fs.readFileSync(SPEC_PATH, 'utf8');
  if (onDisk !== rendered) {
    console.error(
      '❌ swagger.yaml is out of date with the zod schemas.\n' +
        '   Run `npm run openapi:generate` and commit the result.',
    );
    process.exit(1);
  }
  console.log('✅ swagger.yaml is in sync with the zod schemas');
}

if (require.main === module) {
  main();
}
