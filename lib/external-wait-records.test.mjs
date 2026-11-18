import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ToolCallError } from '@openai/agents';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('./external-wait-records.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const waits = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const wait = { documentId: 'w1', title: 'Claude to finish the video', nextCheckAt: '2026-11-16T14:35:00Z' };

test('a parked run is recognised through the Agents SDK tool error wrapper', () => {
  const parked = new waits.RunParkedError(wait);
  assert.equal(waits.parkedFrom(parked), parked);
  // The SDK wraps an error thrown by a tool with errorFunction: null in ToolCallError (original in .error).
  assert.equal(waits.parkedFrom(new ToolCallError('Failed to run function tools', parked)), parked);
  assert.equal(waits.parkedFrom(new Error('outer', { cause: parked })), parked);
  assert.equal(waits.parkedFrom(new Error('plain failure')), null);
  assert.equal(waits.parkedFrom(null), null);
});

test('the check interval follows an every-N-minutes cron', () => {
  assert.equal(waits.cronStepMinutes('*/5 * * * *'), 5);
  assert.equal(waits.cronStepMinutes(' */15 * * * * '), 15);
  assert.equal(waits.cronStepMinutes('0 9 * * *'), null);
  assert.equal(waits.cronStepMinutes('*/0 * * * *'), null);
});

test('the waiting activity names what it waits for and the next check', () => {
  assert.equal(waits.waitingActivity(wait, 'UTC'), 'Waiting for Claude to finish the video · next check 14:35');
  assert.equal(waits.waitingActivity(wait, 'Asia/Kolkata'), 'Waiting for Claude to finish the video · next check 20:05');
  assert.equal(waits.clockTime(wait.nextCheckAt, 'Not/AZone'), waits.clockTime(wait.nextCheckAt));
});
