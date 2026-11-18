// Embeds lib/computer/cc_browser.py into lib/computer/browser-script.ts, so the server can install it on cloud
// computers without reading files at runtime. Run after editing the Python helper: npm run generate:browser-script
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/computer/cc_browser.py', import.meta.url), 'utf8');
if (source.includes('`') || source.includes('${')) throw new Error('cc_browser.py must not contain backticks or "${".');
const version = createHash('sha256').update(source).digest('hex').slice(0, 12);
writeFileSync(new URL('../lib/computer/browser-script.ts', import.meta.url), `// Generated from cc_browser.py by scripts/generate-browser-script.mjs. Do not edit; run npm run generate:browser-script.

/** Changes whenever the helper changes, so computers with an older copy get the new one. */
export const BROWSER_SCRIPT_VERSION = "${version}";

export const BROWSER_SCRIPT = String.raw\`${source}\`;
`);
console.log(`browser-script.ts written (version ${version})`);
