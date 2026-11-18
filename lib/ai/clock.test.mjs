import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('./clock.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const clock = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const now = new Date('2026-11-16T18:30:00Z');

test('the date note uses the configured time zone', () => {
  assert.equal(clock.isoDate(now, 'UTC'), '2026-11-16');
  assert.equal(clock.isoDate(now, 'Asia/Kolkata'), '2026-11-17'); // already past midnight there
  assert.match(clock.describeNow(now, 'UTC'), /^Monday, 16 November 2026, 6:30 PM \(UTC\), ISO date 2026-11-16$/);
  const rules = clock.dateRules(now, 'UTC');
  assert.match(rules, /Current date and time: Monday, 16 November 2026/);
  assert.match(rules, /relative to this date \(2026\)/);
});

test('past years in a query are flagged; the current year and far history are not', () => {
  assert.deepEqual(clock.staleYearsIn('trending hacker news March 2026', now, 'UTC'), []);
  assert.deepEqual(clock.staleYearsIn('latest AI news March 2025', now, 'UTC'), [2025]);
  assert.deepEqual(clock.staleYearsIn('history of the 1969 moon landing', now, 'UTC'), []);
});

test("an invalid or missing headquarters time zone falls back to the server zone", () => {
  assert.ok(clock.resolveTimeZone('Not/AZone') !== 'Not/AZone');
  assert.equal(clock.resolveTimeZone(null), clock.resolveTimeZone());
  assert.equal(clock.resolveTimeZone('Asia/Kolkata'), 'Asia/Kolkata');
});
