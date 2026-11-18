import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('./city-stats.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const cs = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('YouTube channel statistics (numbers as strings)', () => {
  const data = { items: [{ snippet: { title: 'Creator Lab', customUrl: '@creatorlab' }, statistics: { subscriberCount: '12400', viewCount: '981234', videoCount: '87', hiddenSubscriberCount: false } }] };
  assert.equal(cs.sumKey(data, ['subscriberCount']), 12400);
  assert.equal(cs.sumKey(data, ['viewCount']), 981234);
  assert.equal(cs.sumKey(data, ['videoCount']), 87);
  assert.equal(cs.findString(data, ['customUrl', 'title']), '@creatorlab');
});

test('X public metrics and Instagram profile', () => {
  const x = { data: { id: '1', username: 'brand', public_metrics: { followers_count: 5321, following_count: 10, tweet_count: 640 } } };
  assert.equal(cs.sumKey(x, ['followers_count']), 5321);
  assert.equal(cs.sumKey(x, ['tweet_count']), 640);
  assert.equal(cs.findString(x, ['username']), 'brand');
  const ig = { id: '17', username: 'brand.ig', followers_count: 2048, media_count: 120 };
  assert.equal(cs.sumKey(ig, ['followers_count']), 2048);
});

test('Facebook Pages add up, falling back to fan_count', () => {
  const pages = { data: [{ name: 'Brand', followers_count: 1000, fan_count: 900 }, { name: 'Brand Shop', followers_count: 250 }] };
  assert.equal(cs.sumKey(pages, ['followers_count', 'fan_count']), 1250);
  assert.equal(cs.sumKey({ data: [{ name: 'Old page', fan_count: 77 }] }, ['followers_count', 'fan_count']), 77);
});

test('missing or unusable numbers are null, not zero', () => {
  assert.equal(cs.sumKey({ data: {} }, ['followers_count']), null);
  assert.equal(cs.sumKey({ followers_count: 'many' }, ['followers_count']), null);
  assert.equal(cs.sumKey({ followers_count: -3 }, ['followers_count']), null);
  assert.equal(cs.sumKey(null, ['followers_count']), null);
});

test('audience totals only count reported numbers', () => {
  const entry = (followers, views) => ({ connectionId: 'c', toolkit: 't', name: 'T', label: null, updatedAt: null, followers, views, posts: null, handle: null, error: null });
  assert.deepEqual(cs.audienceTotals([entry(100, 5000), entry(50, null)]), { followers: 150, views: 5000 });
  assert.deepEqual(cs.audienceTotals([entry(null, null)]), { followers: null, views: null });
  assert.deepEqual(cs.audienceTotals([]), { followers: null, views: null });
});

test('compact numbers', () => {
  assert.equal(cs.compactNumber(9876), '9,876');
  assert.equal(cs.compactNumber(12400), '12.4K');
  assert.equal(cs.compactNumber(1_250_000), '1.3M');
});
