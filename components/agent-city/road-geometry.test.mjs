import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('./road-geometry.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { roadPath } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const start = { x: 0, y: 0 }, end = { x: 290, y: 290 };

test('routes along either world axis and updates with moved endpoints', () => {
  assert.equal(roadPath(start, end), 'M0,0 L290,0 L290,290');
  assert.equal(roadPath(start, end, 'y-first'), 'M0,0 L0,290 L290,290');
  assert.equal(roadPath(start, { x: -50, y: 100 }), 'M0,0 L-50,0 L-50,100');
});
test('explicit waypoints replace automatic bends, including direct routes', () => {
  assert.equal(roadPath(start, end, 'x-first', [{ x: 80, y: -50 }]), 'M0,0 L80,-50 L290,290');
  assert.equal(roadPath(start, end, 'x-first', []), 'M0,0 L290,290');
});
test('drops duplicate points and omits zero-length or invalid roads', () => {
  assert.equal(roadPath(start, { x: 290, y: 0 }), 'M0,0 L290,0');
  assert.equal(roadPath(start, start), null);
  assert.equal(roadPath(start, { x: Infinity, y: 0 }), null);
  assert.equal(roadPath(start, end, 'x-first', [{ x: NaN, y: 0 }]), null);
});
