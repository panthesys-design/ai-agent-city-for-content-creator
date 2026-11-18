import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const load = async (relative) => {
  const { outputText } = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
};

const python = readFileSync(new URL('./cc_browser.py', import.meta.url), 'utf8');
const script = await load('./browser-script.ts');
const records = await load('../computer-records.ts');
const clock = await load('../ai/run-clock.ts');

test('the embedded browser helper is exactly cc_browser.py (run npm run generate:browser-script)', () => {
  assert.equal(script.BROWSER_SCRIPT, python);
  assert.match(script.BROWSER_SCRIPT_VERSION, /^[0-9a-f]{12}$/);
  assert.ok(!python.includes('`') && !python.includes('${'), 'cc_browser.py must not contain backticks or "${"');
});

test('the page scripts the helper runs in Chrome are valid JavaScript', () => {
  const block = (name) => python.match(new RegExp(`${name} = r"""([\\s\\S]*?)"""`))?.[1];
  const read = block('READ_JS').replace(/%\((max|offset|limit)\)d/g, '10');
  const status = block('STATUS_JS');
  assert.ok(read && status);
  assert.doesNotThrow(() => new Function(`return ${read}`));
  assert.doesNotThrow(() => new Function(`return ${status}`));
  // Upload and wait scripts are filled in with Python %-formatting: %(name)s gets JSON, %% is a literal %.
  const fill = (js) => js.replace(/%\((\w+)\)s/g, 'null').replace(/%%/g, '%');
  const upload = block('UPLOAD_JS'), wait = block('WAIT_JS');
  assert.ok(upload && wait);
  assert.doesNotThrow(() => new Function(`return ${fill(upload)}`));
  assert.doesNotThrow(() => new Function(`return ${fill(wait)}`));
  assert.ok(!/%[^%(]/.test(wait.replace(/%%/g, '').replace(/%\(\w+\)s/g, '')), 'WAIT_JS has an unescaped % (use %%)');
  const search = block('SEARCH_JS');
  assert.ok(search);
  for (const engine of ['google', 'bing']) {
    assert.doesNotThrow(() => new Function(`return ${search.replace('__ENGINE__', engine).replace('__MAX__', '8')}`));
  }
});

test('requests are parsed defensively', () => {
  const request = records.requestFromStrapi({
    documentId: 'abc12345', kind: 'choice', status: 'pending', title: 'Which voice service?', allowOther: true,
    options: [{ id: 'elevenlabs', label: 'ElevenLabs', description: 'Natural voices' }, { id: '', label: 'bad' }, null, { id: 'deepgram', label: 'Deepgram' }],
    response: { optionId: 'elevenlabs', extra: 1 }, agent: { documentId: 'agent123', name: 'Voice Agent' }, task: { documentId: 'task1234' },
  });
  assert.equal(request.kind, 'choice');
  assert.deepEqual(request.options.map((o) => o.id), ['elevenlabs', 'deepgram']);
  assert.deepEqual(request.response, { optionId: 'elevenlabs' });
  assert.equal(request.agentName, 'Voice Agent');
  assert.equal(records.requestFromStrapi({ documentId: 'x', kind: 'nope', status: 'weird' }).kind, 'action');
  assert.equal(records.needsComputer('login'), true);
  assert.equal(records.needsComputer('choice'), false);
});

test('a computer without a holder shows nobody using it', () => {
  const held = records.computerFromStrapi({ state: 'running', holderRun: 'run-1', holderAgent: { documentId: 'a1', name: 'Research Agent' }, activity: 'Reading' });
  assert.equal(held.agentName, 'Research Agent');
  const released = records.computerFromStrapi({ state: 'running', holderRun: null, holderAgent: { documentId: 'a1', name: 'Research Agent' } });
  assert.equal(released.agentId, null);
  assert.equal(records.computerFromStrapi(null).state, 'stopped');
  assert.equal(records.computerFromStrapi({ state: 'melting' }).state, 'stopped');
});

test('capability keys normalise free text so remembered choices match', () => {
  assert.equal(records.capabilityKey('Voice generation'), 'voice_generation');
  assert.equal(records.capabilityKey('  voice_generation '), 'voice_generation');
  assert.equal(records.capabilityKey('Text-to-Speech (TTS)'), 'text_to_speech_tts');
});

test('a run clock stops counting while paused', async () => {
  const run = new clock.RunClock(0.15);
  await clock.withRunClock(run, async () => {
    const resume = clock.pauseRunClocks();
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(run.signal.aborted, false, 'paused time must not count');
    resume();
  });
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(run.expired, true);
  run.dispose();
});

test('nested run clocks all pause, and a parent abort still stops the run', async () => {
  const parent = new AbortController();
  const task = new clock.RunClock(0.1, parent.signal);
  const agent = new clock.RunClock(0.1);
  await clock.withRunClock(task, () => clock.withRunClock(agent, async () => {
    const resume = clock.pauseRunClocks();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(task.signal.aborted || agent.signal.aborted, false);
    parent.abort();
    assert.equal(task.signal.aborted, true);
    assert.equal(task.expired, false);
    resume();
  }));
  task.dispose(); agent.dispose();
});

test('approvals and open questions are answered in the app, not on the computer', () => {
  assert.equal(records.needsComputer('confirm'), false);
  assert.equal(records.needsComputer('login'), true);
  assert.equal(records.isQuestion('confirm'), true);
  assert.equal(records.isQuestion('choice'), true);
  assert.equal(records.isQuestion('captcha'), false);
  assert.deepEqual(records.CONFIRM_OPTIONS.map((o) => o.id), ['approve', 'decline']);
  assert.equal(records.requestLabel({ kind: 'choice', options: [] }), 'Question');
  assert.equal(records.requestLabel({ kind: 'choice', options: [{ id: 'a', label: 'A' }] }), 'Choose an option');
  assert.equal(records.requestLabel({ kind: 'confirm', options: records.CONFIRM_OPTIONS }), 'Approval needed');
  assert.equal(records.requestFromStrapi({ documentId: 'req12345', kind: 'confirm' }).kind, 'confirm');
});
