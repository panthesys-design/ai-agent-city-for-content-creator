import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('./artifact-records.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const ar = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('excerpts strip Markdown syntax and truncate', () => {
  const text = '# Script\n\n## Scene 1\n\n**Hook:** Did you know [this](https://x.dev)?\n\n```js\ncode()\n```\n- one\n- two';
  assert.equal(ar.excerptOf(text), 'Script Scene 1 Hook: Did you know this? one two');
  assert.equal(ar.excerptOf('a'.repeat(400), 10), `${'a'.repeat(9)}…`);
  assert.equal(ar.excerptOf(''), null);
  assert.equal(ar.excerptOf(null), null);
});

test('only http(s) URLs are kept', () => {
  assert.equal(ar.safeUrl('https://ik.imagekit.io/demo/a.png'), 'https://ik.imagekit.io/demo/a.png');
  assert.equal(ar.safeUrl('javascript:alert(1)'), null);
  assert.equal(ar.safeUrl('data:image/png;base64,AAAA'), null);
  assert.equal(ar.safeUrl(42), null);
});

test('Strapi rows become records with relations, fallbacks, and a safe URL', () => {
  const record = ar.artifactFromStrapi({
    documentId: 'abc12345', title: 'Topics', type: 'document', category: 'topics', content: '1. First\n2. Second',
    url: 'javascript:alert(1)', agent: { documentId: 'agent1234', name: 'Research' }, task: { documentId: 'task12345' },
    data: [1, 2], createdAt: '2026-11-16T10:00:00.000Z',
  });
  assert.equal(record.agentId, 'agent1234');
  assert.equal(record.agentName, 'Research');
  assert.equal(record.taskId, 'task12345');
  assert.equal(record.url, null);
  assert.equal(record.data, null, 'array data is not an object');
  assert.equal(record.excerpt, '1. First 2. Second');
  const fallback = ar.artifactFromStrapi({ documentId: 'x1234567', type: 'spreadsheet', category: 'nope' });
  assert.equal(fallback.type, 'document');
  assert.equal(fallback.category, 'other');
  assert.equal(fallback.title, 'Untitled');
});

test('message metadata yields only well-formed artifact snapshots', () => {
  const list = ar.artifactsFromMetadata({
    artifacts: [
      { documentId: 'img12345', title: 'Thumb', type: 'image', category: 'image', url: 'https://cdn.example/a.jpg' },
      { title: 'no id' },
      null,
      { documentId: 'bad12345', type: 'image', url: 'javascript:x' },
    ],
  });
  assert.equal(list.length, 2);
  assert.equal(list[0].url, 'https://cdn.example/a.jpg');
  assert.equal(list[1].url, null);
  assert.deepEqual(ar.artifactsFromMetadata(null), []);
  assert.deepEqual(ar.artifactsFromMetadata({ artifacts: 'x' }), []);
});

test('timeline scenes are sorted and sanitized', () => {
  const scenes = ar.timelineScenes({
    scenes: [
      { order: 2, narration: 'b', durationSeconds: 4, imageUrl: 'ftp://x', audioUrl: 'https://a.mp3' },
      { order: 1, narration: 'a', durationSeconds: 3, imageUrl: 'https://i.jpg', caption: 'Intro' },
    ],
  });
  assert.deepEqual(scenes.map((s) => s.order), [1, 2]);
  assert.equal(scenes[0].caption, 'Intro');
  assert.equal(scenes[1].imageUrl, null);
  assert.equal(scenes[1].audioUrl, 'https://a.mp3');
  assert.deepEqual(ar.timelineScenes(null), []);
});

test('download names are file-safe', () => {
  assert.equal(ar.downloadName({ title: 'Script: AI Note-Taking (60s)!' }, 'md'), 'script-ai-note-taking-60s.md');
  assert.equal(ar.downloadName({ title: '!!!' }, 'md'), 'artifact.md');
});

test('message metadata keeps reply artifacts and user attachments apart', () => {
  const upload = { documentId: 'upl12345', title: 'Logo', type: 'image', category: 'upload', url: 'https://ik.imagekit.io/demo/logo.png' };
  const reply = { documentId: 'doc12345', title: 'Script', type: 'document', category: 'script' };
  const metadata = { artifacts: [reply], attachments: [upload, { title: 'no id' }] };
  assert.deepEqual(ar.artifactsFromMetadata(metadata).map((a) => a.documentId), ['doc12345']);
  const attachments = ar.artifactsFromMetadata(metadata, 'attachments');
  assert.deepEqual(attachments.map((a) => [a.documentId, a.category]), [['upl12345', 'upload']]);
  assert.equal(ar.artifactCategoryLabels.upload, 'Upload');
  assert.deepEqual(ar.artifactsFromMetadata(null, 'attachments'), []);
});
