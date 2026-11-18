import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('./upload-records.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const up = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('upload types are decided by extension', () => {
  assert.equal(up.UPLOAD_TYPES[up.extensionOf('Brand Logo.PNG')], 'image/png');
  assert.equal(up.UPLOAD_TYPES[up.extensionOf('notes.md')], 'text/markdown');
  assert.equal(up.UPLOAD_TYPES[up.extensionOf('script.exe')], undefined);
  assert.equal(up.UPLOAD_TYPES[up.extensionOf('README')], undefined);
  assert.ok(up.UPLOAD_ACCEPT.split(',').every((ext) => ext.startsWith('.')));
  assert.ok(up.TEXT_UPLOAD_TYPES.has('text/csv'));
});

test('sizes are formatted for people', () => {
  assert.equal(up.formatBytes(512), '512 B');
  assert.equal(up.formatBytes(2048), '2 KB');
  assert.equal(up.formatBytes(25 * 1024 * 1024), '25.0 MB');
});
