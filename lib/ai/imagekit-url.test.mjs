import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('./imagekit-url.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const ik = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const ENDPOINT = 'https://ik.imagekit.io/demo';

test('prompts with punctuation use base64 prompte- encoding', () => {
  const { transformation } = ik.transformationFor({ operation: 'edit', prompt: 'Add a hat, red: bright/shiny' });
  const encoded = transformation.replace('e-edit-prompte-', '');
  assert.equal(Buffer.from(decodeURIComponent(encoded), 'base64').toString(), 'Add a hat, red: bright/shiny');
  assert.ok(!/[,:/]/.test(encoded));
});

test('builds each operation and reports missing parameters', () => {
  assert.deepEqual(ik.transformationFor({ operation: 'remove_background' }), { transformation: 'e-bgremove:f-png' });
  assert.deepEqual(ik.transformationFor({ operation: 'remove_background', highQuality: true }), { transformation: 'e-removedotbg:f-png' });
  assert.deepEqual(ik.transformationFor({ operation: 'upscale' }), { transformation: 'e-upscale' });
  assert.deepEqual(ik.transformationFor({ operation: 'variation' }), { transformation: 'e-genvar' });
  assert.deepEqual(ik.transformationFor({ operation: 'generative_fill', width: 1280, height: 720 }), { transformation: 'bg-genfill,w-1280,h-720,cm-pad_resize' });
  assert.deepEqual(ik.transformationFor({ operation: 'smart_crop', width: 720, height: 1280, focus: 'Face' }), { transformation: 'w-720,h-1280,fo-face' });
  assert.deepEqual(ik.transformationFor({ operation: 'drop_shadow', shadow: { azimuth: 400, elevation: 30, saturation: 50 } }), { transformation: 'e-removedotbg:e-dropshadow-az-360_el-30_st-50:f-png' });
  assert.ok('error' in ik.transformationFor({ operation: 'edit', prompt: '  ' }));
  assert.ok('error' in ik.transformationFor({ operation: 'change_background' }));
  assert.ok('error' in ik.transformationFor({ operation: 'generative_fill', width: 1280 }));
  assert.ok('error' in ik.transformationFor({ operation: 'smart_crop', width: 100, height: 100, focus: 'x,y' }));
});

test('text-to-image URL strips URL syntax from the prompt and adds the aspect crop', () => {
  const url = ik.generationUrl(`${ENDPOINT}/`, 'A cat, sitting: on a mat/rug?', 'landscape', '/gen/cat-1.jpg');
  assert.equal(url, `${ENDPOINT}/ik-genimg-prompt-A%20cat%20sitting%20on%20a%20mat%20rug/gen/cat-1.jpg?tr=w-1280,h-720,fo-auto`);
  assert.ok(!ik.generationUrl(ENDPOINT, 'x', 'square', 'a.jpg').includes('?'));
});

test('appends to existing query, chains existing tr, drops old signatures', () => {
  assert.equal(ik.transformedUrl(`${ENDPOINT}/a.png?updatedAt=1`, 'e-upscale'), `${ENDPOINT}/a.png?updatedAt=1&tr=e-upscale`);
  assert.equal(ik.transformedUrl(`${ENDPOINT}/a.png?tr=w-100&ik-s=abc&ik-t=1`, 'e-genvar'), `${ENDPOINT}/a.png?tr=w-100:e-genvar`);
  assert.equal(ik.transformedUrl(`${ENDPOINT}/a.png`, 'e-edit-prompte-YQ%3D%3D'), `${ENDPOINT}/a.png?tr=e-edit-prompte-YQ%3D%3D`);
});

test('accepts only https URLs under the configured endpoint', () => {
  assert.ok(ik.isImageKitUrl(`${ENDPOINT}/folder/a.png?x=1`, ENDPOINT));
  assert.ok(!ik.isImageKitUrl('https://ik.imagekit.io/other/a.png', ENDPOINT));
  assert.ok(!ik.isImageKitUrl('https://ik.imagekit.io/demoX/a.png', ENDPOINT));
  assert.ok(!ik.isImageKitUrl('http://ik.imagekit.io/demo/a.png', ENDPOINT));
  assert.ok(!ik.isImageKitUrl('http://169.254.169.254/latest', ENDPOINT));
  assert.ok(!ik.isImageKitUrl(`${ENDPOINT}/`, ENDPOINT));
});

test('signs the path after the endpoint plus expiry with HMAC-SHA1', () => {
  const now = 1_700_000_000_000;
  const signed = ik.signImageKitUrl(`${ENDPOINT}/a.png?tr=w-100`, ENDPOINT, 'private_key', 300, now);
  const expiry = 1_700_000_300;
  const signature = createHmac('sha1', 'private_key').update(`a.png?tr=w-100${expiry}`).digest('hex');
  assert.equal(signed, `${ENDPOINT}/a.png?tr=w-100&ik-t=${expiry}&ik-s=${signature}`);
  assert.equal(ik.signImageKitUrl('https://elsewhere.com/a.png', ENDPOINT, 'k'), 'https://elsewhere.com/a.png');
});
