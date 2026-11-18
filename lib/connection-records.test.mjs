import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('./connection-records.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const cr = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const AGENT = 'agent0000001';
const OTHER = 'agent0000002';
const base = { status: 'active', agentAccess: 'all', allowedAgents: [], permission: 'publish', requireApproval: true };

test('tool effects come from Composio tags; untagged tools count as writes', () => {
  assert.equal(cr.toolEffect(['readOnlyHint', 'openWorldHint']), 'read');
  assert.equal(cr.toolEffect(['important', 'createHint']), 'write');
  assert.equal(cr.toolEffect(['readOnlyHint', 'updateHint']), 'write');
  assert.equal(cr.toolEffect(['destructiveHint', 'readOnlyHint']), 'destructive');
  assert.equal(cr.toolEffect([]), 'write');
  assert.equal(cr.toolEffect(undefined), 'write');
});

test('only active connections are usable, and selected access is per agent', () => {
  assert.equal(cr.agentCanUse(base, AGENT), true);
  assert.equal(cr.agentCanUse({ ...base, status: 'disabled' }, AGENT), false);
  assert.equal(cr.agentCanUse({ ...base, status: 'expired' }, AGENT), false);
  const selected = { ...base, agentAccess: 'selected', allowedAgents: [AGENT] };
  assert.equal(cr.agentCanUse(selected, AGENT), true);
  assert.equal(cr.agentCanUse(selected, OTHER), false);
  // Headquarters (no agent) never runs app tools itself.
  assert.equal(cr.agentCanUse(base, null), false);
});

test('read-only connections refuse writes; deletions always need approval', () => {
  assert.deepEqual(cr.toolPolicy({ permission: 'read', requireApproval: false }, 'read'), { allowed: true, approval: false });
  assert.equal(cr.toolPolicy({ permission: 'read', requireApproval: false }, 'write').allowed, false);
  assert.equal(cr.toolPolicy({ permission: 'read', requireApproval: false }, 'destructive').allowed, false);
  assert.deepEqual(cr.toolPolicy({ permission: 'publish', requireApproval: true }, 'write'), { allowed: true, approval: true });
  // The workspace's "ask" (the default) asks for every change; "auto" leaves it to the account.
  assert.deepEqual(cr.toolPolicy({ permission: 'publish', requireApproval: false }, 'write'), { allowed: true, approval: true });
  assert.deepEqual(cr.toolPolicy({ permission: 'publish', requireApproval: false }, 'write', 'auto'), { allowed: true, approval: false });
  assert.deepEqual(cr.toolPolicy({ permission: 'publish', requireApproval: true }, 'write', 'auto'), { allowed: true, approval: true });
  assert.deepEqual(cr.toolPolicy({ permission: 'publish', requireApproval: false }, 'destructive', 'auto'), { allowed: true, approval: true });
  assert.deepEqual(cr.toolPolicy({ permission: 'publish', requireApproval: false }, 'destructive'), { allowed: true, approval: true });
});

test('settings from the browser are validated', () => {
  assert.ok('error' in cr.parseConnectionSettings({ permission: 'admin', agentAccess: 'all' }));
  assert.ok('error' in cr.parseConnectionSettings({ permission: 'read', agentAccess: 'selected', allowedAgents: [] }));
  const ok = cr.parseConnectionSettings({ permission: 'publish', agentAccess: 'selected', allowedAgents: [AGENT, AGENT, 'bad id!', 7], requireApproval: false });
  assert.deepEqual(ok.settings, { permission: 'publish', agentAccess: 'selected', allowedAgents: [AGENT], requireApproval: false });
  // "All agents" drops any stale selection.
  assert.deepEqual(cr.parseConnectionSettings({ permission: 'read', agentAccess: 'all', allowedAgents: [AGENT] }).settings.allowedAgents, []);
});

test('Composio statuses map to ours', () => {
  assert.equal(cr.statusFromComposio('ACTIVE'), 'active');
  assert.equal(cr.statusFromComposio('INITIATED'), 'initiated');
  assert.equal(cr.statusFromComposio('EXPIRED'), 'expired');
  assert.equal(cr.statusFromComposio('ACTIVE', true), 'disabled');
  assert.equal(cr.statusFromComposio('WHATEVER'), 'failed');
});

test('rows from Strapi get safe defaults', () => {
  const row = cr.connectionFromStrapi({ documentId: 'abc', toolkit: 'twitter', status: 'bogus', allowedAgents: 'nope', requireApproval: null });
  assert.equal(row.toolkitName, 'X (Twitter)');
  assert.equal(row.status, 'initiated');
  assert.equal(row.permission, 'publish');
  assert.deepEqual(row.allowedAgents, []);
  assert.equal(row.requireApproval, true);
});

test('post links are found in nested tool results, https only', () => {
  assert.equal(cr.findResultUrl({ data: { post: { permalink: 'https://instagram.com/p/x' } } }), 'https://instagram.com/p/x');
  assert.equal(cr.findResultUrl({ url: 'javascript:alert(1)' }), null);
  assert.equal(cr.findResultUrl({ url: 'http://insecure.example' }), null);
  assert.equal(cr.findResultUrl(null), null);
});

test('toolkit slugs are checked', () => {
  assert.equal(cr.isToolkitSlug('googlesheets'), true);
  assert.equal(cr.isToolkitSlug('../etc'), false);
  assert.equal(cr.isToolkitSlug('A'), false);
});

test('appForUrl matches connected apps by host, subdomain, and Google path prefix', () => {
  const connected = ['instagram', 'twitter', 'googlesheets', 'youtube'];
  assert.equal(cr.appForUrl('https://www.instagram.com/p/abc/', connected), 'instagram');
  assert.equal(cr.appForUrl('instagram.com', connected), 'instagram');
  assert.equal(cr.appForUrl('https://x.com/home', connected), 'twitter');
  assert.equal(cr.appForUrl('https://studio.youtube.com/channel/x', connected), 'youtube');
  assert.equal(cr.appForUrl('https://docs.google.com/spreadsheets/d/1/edit', connected), 'googlesheets');
  assert.equal(cr.appForUrl('https://docs.google.com/document/d/1/edit', connected), null);
  assert.equal(cr.appForUrl('https://notinstagram.com/', connected), null);
  assert.equal(cr.appForUrl('https://instagram.com.evil.example/', connected), null);
  assert.equal(cr.appForUrl('https://www.linkedin.com/feed', connected), null);
  assert.equal(cr.appForUrl('file:///etc/passwd', connected), null);
  assert.equal(cr.appForUrl('not a url', connected), null);
  assert.equal(cr.appForUrl('https://instagram.com/', []), null);
});

test('drafts are ready only when prepared for an active account that may post', () => {
  const conns = [
    { documentId: 'acct00000001', toolkit: 'linkedin', status: 'active', permission: 'publish' },
    { documentId: 'acct00000002', toolkit: 'instagram', status: 'active', permission: 'read' },
  ];
  assert.equal(cr.draftReadiness({ toolkit: 'twitter', toolSlug: '', connectionId: null }, conns), 'connect');
  assert.equal(cr.draftReadiness({ toolkit: 'linkedin', toolSlug: '', connectionId: null }, conns), 'prepare');
  assert.equal(cr.draftReadiness({ toolkit: 'linkedin', toolSlug: 'LINKEDIN_CREATE_LINKED_IN_POST', connectionId: 'acct00000001' }, conns), 'ready');
  // Prepared for an account that was since replaced: prepare again.
  assert.equal(cr.draftReadiness({ toolkit: 'linkedin', toolSlug: 'LINKEDIN_CREATE_LINKED_IN_POST', connectionId: 'gone00000000' }, conns), 'prepare');
  assert.equal(cr.draftReadiness({ toolkit: 'instagram', toolSlug: 'INSTAGRAM_CREATE_POST', connectionId: 'acct00000002' }, conns), 'posting');
  assert.equal(cr.draftReadiness({ toolkit: 'linkedin', toolSlug: 'X', connectionId: 'acct00000001' }, [{ ...conns[0], status: 'expired' }]), 'connect');
});

test('schedule times must be 5 minutes to a year ahead', () => {
  const now = Date.parse('2026-11-16T10:00:00Z');
  assert.equal(cr.scheduleTimeProblem('2026-11-16T10:10:00Z', now), null);
  assert.match(cr.scheduleTimeProblem('2026-11-16T10:01:00Z', now), /5 minutes/);
  assert.match(cr.scheduleTimeProblem('2028-01-01T00:00:00Z', now), /within a year/);
  assert.match(cr.scheduleTimeProblem('not a date', now), /Pick/);
});

test('posts land on the calendar by publish time; undated drafts stay in the tray', () => {
  assert.equal(cr.postDate({ status: 'draft', publishAt: null, publishedAt: null, createdAt: '2026-11-01T00:00:00Z' }), null);
  assert.equal(cr.postDate({ status: 'draft', publishAt: '2026-11-20T09:00:00Z', publishedAt: null, createdAt: 'x' }), '2026-11-20T09:00:00Z');
  assert.equal(cr.postDate({ status: 'published', publishAt: '2026-11-20T09:00:00Z', publishedAt: '2026-11-20T09:03:00Z', createdAt: 'x' }), '2026-11-20T09:03:00Z');
  const row = cr.postFromStrapi({ documentId: 'p1', toolkit: 'x', media: ['https://ik.imagekit.io/a.png', 'javascript:alert(1)', 'http://plain.example/a.png'] });
  assert.equal(row.status, 'draft');
  assert.deepEqual(row.media, ['https://ik.imagekit.io/a.png']);
});
