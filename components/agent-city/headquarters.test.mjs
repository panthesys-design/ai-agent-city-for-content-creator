import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const rendererSource = readFileSync(new URL('./renderer.js', import.meta.url), 'utf8');
const { createBuildingRenderer } = new Function(rendererSource.replace('export function', 'function') + '; return { createBuildingRenderer };')();
const { outputText } = ts.transpileModule(readFileSync(new URL('./headquarters-geometry.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { headquartersHeight } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

// Small SVG DOM double: exercises drawing logic and resource references, not browser paint.
class SvgNode {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.markup = ''; this.textContent = ''; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  appendChild(node) { this.children.push(node); return node; }
  insertBefore(node, before) { this.children.splice(this.children.indexOf(before), 0, node); return node; }
  replaceChildren() { this.children = []; }
  set innerHTML(value) { this.markup = value; }
  querySelectorAll() {
    return [...this.markup.matchAll(/id="([^"]+)"/g)].map(([, initial]) => {
      const update = value => { this.markup = this.markup.replace(`id="${initial}"`, `id="${value}"`); };
      return { get id() { return initial; }, set id(value) { update(value); } };
    });
  }
  cloneNode(deep) {
    const node = new SvgNode(this.tag);
    node.attrs = { ...this.attrs }; node.textContent = this.textContent; node.markup = this.markup;
    node.children = deep ? this.children.map(c => c.cloneNode(true)) : [];
    return node;
  }
  serialize() {
    return `<${this.tag} ${Object.entries(this.attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>${this.markup}${this.textContent}${this.children.map(c => c.serialize()).join('')}</${this.tag}>`;
  }
}
function render(building, prefix = 'test') {
  const original = globalThis.document;
  globalThis.document = { createElementNS: (_, tag) => new SvgNode(tag) };
  try {
    const defs = new SvgNode('defs'), group = new SvgNode('g');
    createBuildingRenderer(defs, prefix)(group, building);
    return defs.serialize() + group.serialize();
  } finally { if (original === undefined) delete globalThis.document; else globalThis.document = original; }
}
const base = { type: 'skyscraper', id: 'hq', name: 'Headquarters', x: 0, y: 0 };

test('all HQ styles, heights, tints, and spire settings produce finite SVG with resolved resources', () => {
  for (const style of ['empire', 'crown', 'twin']) for (const height of [1, 2, 3, 4, 5])
    for (const tint of ['blue', 'teal', 'warm', 'clear']) for (const spire of [false, true]) {
      const svg = render({ ...base, style, height, tint, spire, theme: 'gold' });
      assert.ok(svg.includes('<polygon'));
      assert.ok(!/NaN|Infinity|undefined/.test(svg), `${style}/${height}/${tint}/${spire}`);
      const ids = new Set([...svg.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
      for (const [, id] of svg.matchAll(/url\(#([^)]*)\)/g)) assert.ok(ids.has(id), `Missing resource ${id}`);
    }
});
test('palettes and independent preview instances keep their resources isolated', () => {
  const ids = new Set();
  for (const theme of ['lavender', 'mint', 'peach', 'sky', 'rose', 'white', 'gold']) {
    const svg = render({ ...base, theme }, `preview-${theme}`);
    for (const [, id] of svg.matchAll(/id="([^"]+)"/g)) {
      assert.ok(!ids.has(id), `Duplicate resource ${id}`); ids.add(id);
    }
  }
});
test('preview skyline grows with height and includes extra space for the spire', () => {
  for (const style of ['empire', 'crown', 'twin']) {
    let previous = 0;
    for (const height of [1, 2, 3, 4, 5]) {
      const size = headquartersHeight({ ...base, style, height });
      assert.ok(size > previous);
      assert.ok(size > headquartersHeight({ ...base, style, height, spire: false }));
      previous = size;
    }
  }
});
test('legacy campus and agent offices remain renderable', () => {
  for (const type of ['tower', 'office', 'stepped', 'agent']) {
    const svg = render({ ...base, type, name: 'Legacy office', extras: [] });
    assert.ok(svg.includes('<polygon'));
    assert.ok(!/NaN|Infinity|undefined/.test(svg));
  }
});
