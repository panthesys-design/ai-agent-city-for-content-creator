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

const { streetWaypoints, snapToPlot, isPlotFree, CITY_PLOT } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const hq = { x: 290, y: 290 };
const crossesAPlot = (points, plots) => points.slice(1).some((p, i) => {
  const a = points[i];
  // Sample each segment and check it never enters another plot's pad (±110).
  for (let t = 0; t <= 1; t += 1 / 58) {
    const x = a.x + (p.x - a.x) * t, y = a.y + (p.y - a.y) * t;
    if (plots.some(c => Math.abs(c.x - x) < 110 && Math.abs(c.y - y) < 110)) return true;
  }
  return false;
});

test('street routes leave through the front and stay in the gaps between plots', () => {
  assert.deepEqual(streetWaypoints({ x: 0, y: 290 }, hq), [{ x: 0, y: 435 }, { x: 290, y: 435 }]);
  assert.deepEqual(streetWaypoints({ x: 580, y: 0 }, hq), [{ x: 580, y: 145 }, { x: 435, y: 145 }, { x: 435, y: 435 }, { x: 290, y: 435 }]);
  assert.equal(roadPath({ x: 290, y: 580 }, hq, 'street'), 'M290,580 L290,725 L435,725 L435,435 L290,435 L290,290');
  const cells = [];
  for (let col = -2; col <= 4; col++) for (let row = -2; row <= 4; row++) cells.push({ x: col * CITY_PLOT, y: row * CITY_PLOT });
  for (const from of cells) {
    if (from.x === hq.x && from.y === hq.y) continue;
    const others = cells.filter(c => c !== from && !(c.x === hq.x && c.y === hq.y));
    // Only the driveways inside the start and end plots may overlap a pad.
    const route = streetWaypoints(from, hq);
    assert.equal(crossesAPlot(route, others), false, `route from ${from.x},${from.y}`);
  }
});

test('snaps to plots and detects occupied plots', () => {
  assert.deepEqual(snapToPlot({ x: 140, y: 470 }), { x: 0, y: 580 });
  assert.deepEqual(snapToPlot({ x: -150, y: -10 }), { x: -290, y: 0 });
  const buildings = [{ id: 'hq', x: 290, y: 290 }, { id: 'a', x: 0, y: 290 }];
  assert.equal(isPlotFree(buildings, { x: 0, y: 290 }), false);
  assert.equal(isPlotFree(buildings, { x: 0, y: 290 }, 'a'), true);
  assert.equal(isPlotFree(buildings, { x: 0, y: 0 }), true);
});
