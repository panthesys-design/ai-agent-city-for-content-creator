import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const transpile = (relative) => ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
// task-records imports artifact-records; point that import at a data URL of its own.
const artifacts = dataUrl(transpile('./artifact-records.ts'));
const records = await import(dataUrl(transpile('./task-records.ts').replace('"./artifact-records"', JSON.stringify(artifacts))));

const step = (status, extra = {}) => ({ id: 's', agentId: 'a', agentName: 'A', title: 't', dependsOn: [], status, ...extra });

test('a request holds the queue only while it is dispatched or still planning', () => {
  const { isPlanningRequest } = records;
  assert.equal(isPlanningRequest({ status: 'queued', jobRunId: null, plan: null }), false, 'waiting its turn');
  assert.equal(isPlanningRequest({ status: 'queued', jobRunId: 'run-1', plan: null }), true, 'dispatched, not started');
  assert.equal(isPlanningRequest({ status: 'running', jobRunId: null, plan: null }), true, 'planning or answering');
  assert.equal(isPlanningRequest({ status: 'running', jobRunId: null, plan: [step('pending'), step('pending')] }), true, 'planned, nothing handed out');
  assert.equal(isPlanningRequest({ status: 'running', jobRunId: null, plan: [step('active'), step('pending')] }), false, 'first step handed to an agent');
  assert.equal(isPlanningRequest({ status: 'running', jobRunId: null, plan: [step('active', { waitingFor: 'Video Editor to be free' })] }), false, 'step waiting for its agent');
  assert.equal(isPlanningRequest({ status: 'completed', jobRunId: null, plan: null }), false);
});

test('a plan step keeps what it is waiting for', () => {
  const task = records.taskFromStrapi({ documentId: 'd', status: 'running', plan: [step('active', { waitingFor: 'Claude to finish the video' }), step('done', { waitingFor: '' })] });
  assert.equal(task.plan[0].waitingFor, 'Claude to finish the video');
  assert.equal('waitingFor' in task.plan[1], false);
});
