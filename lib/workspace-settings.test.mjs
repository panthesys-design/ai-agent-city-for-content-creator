import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const load = (file, replace = {}) => {
  let { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  for (const [from, to] of Object.entries(replace)) outputText = outputText.replaceAll(`"${from}"`, `"${to}"`);
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
};
const config = await import(load('./agent-config.ts'));
const ws = await import(load('./workspace-settings.ts', { './agent-config': load('./agent-config.ts') }));

const form = (fields) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const valid = { timeZone: 'Asia/Kolkata', model: '', reasoningEffort: '', maxTurns: '20', timeoutSeconds: '600', publishingApproval: 'ask' };

test('time zones are validated against Intl', () => {
  assert.equal(ws.isValidTimeZone('Asia/Kolkata'), true);
  assert.equal(ws.isValidTimeZone('UTC'), true);
  assert.equal(ws.isValidTimeZone('Not/AZone'), false);
  assert.equal(ws.isValidTimeZone(''), false);
  assert.equal(ws.timeZoneFrom(null), null);
});

test('the workspace form parses and rejects bad values', () => {
  const ok = ws.parseWorkspaceForm(form(valid));
  assert.deepEqual(ok, { input: {
    timeZone: 'Asia/Kolkata', publishingApproval: 'ask',
    agentDefaults: { model: null, reasoningEffort: null, maxTurns: 20, timeoutSeconds: 600 },
  } });
  assert.equal(ws.parseWorkspaceForm(form({ ...valid, model: ' gpt-5.4-mini ', reasoningEffort: 'high' })).input.agentDefaults.model, 'gpt-5.4-mini');
  assert.match(ws.parseWorkspaceForm(form({ ...valid, timeZone: 'Mars/Base' })).error, /time zone/);
  assert.match(ws.parseWorkspaceForm(form({ ...valid, model: 'bad model!' })).error, /model ID/);
  assert.match(ws.parseWorkspaceForm(form({ ...valid, reasoningEffort: 'extreme' })).error, /reasoning/);
  assert.match(ws.parseWorkspaceForm(form({ ...valid, maxTurns: '0' })).error, /Max turns/);
  assert.match(ws.parseWorkspaceForm(form({ ...valid, maxTurns: '2.5' })).error, /Max turns/);
  assert.match(ws.parseWorkspaceForm(form({ ...valid, timeoutSeconds: '10' })).error, /Time limit/);
  assert.match(ws.parseWorkspaceForm(form({ ...valid, publishingApproval: 'sometimes' })).error, /publish/);
});

test('stored values fall back to safe defaults', () => {
  assert.deepEqual(ws.agentDefaultsFrom(null), { model: null, ...config.DEFAULT_SETTINGS });
  assert.deepEqual(ws.agentDefaultsFrom({ model: 'gpt-5.5', reasoningEffort: 'low', maxTurns: 999, timeoutSeconds: 120 }),
    { model: 'gpt-5.5', reasoningEffort: 'low', maxTurns: config.DEFAULT_SETTINGS.maxTurns, timeoutSeconds: 120 });
  assert.equal(ws.publishingApprovalFrom(undefined), 'ask');
  assert.equal(ws.publishingApprovalFrom('auto'), 'auto');
  assert.equal(ws.publishingApprovalFrom('AUTO'), 'ask');
});

test('new agents start from the workspace defaults', () => {
  const runtime = config.defaultRuntimeConfig('research', { model: 'gpt-5.5', reasoningEffort: 'high', maxTurns: 40, timeoutSeconds: 900 });
  assert.equal(runtime.model, 'gpt-5.5');
  assert.deepEqual(runtime.settings, { reasoningEffort: 'high', maxTurns: 40, timeoutSeconds: 900 });
  assert.deepEqual(config.defaultRuntimeConfig('script').settings, config.DEFAULT_SETTINGS);
});

test('profile names and the deletion phrase', () => {
  assert.deepEqual(ws.parseProfileForm(form({ displayName: '  Ada   Lovelace ' })), { displayName: 'Ada Lovelace' });
  assert.deepEqual(ws.parseProfileForm(form({ displayName: '   ' })), { displayName: null });
  assert.match(ws.parseProfileForm(form({ displayName: 'x'.repeat(65) })).error, /64/);
  assert.equal(ws.confirmsDeletion(' creator  hq ', 'Creator HQ'), true);
  assert.equal(ws.confirmsDeletion('Creator', 'Creator HQ'), false);
  assert.equal(ws.confirmsDeletion('', ''), false);
});
