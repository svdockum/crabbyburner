import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLogTracker, projectName } from '../src/logs.mjs';

const NOW = Date.parse('2026-10-04T18:00:00Z');

function reply({ id, req = 'req_1', t = NOW - 60e3, out = 100, cwd = 'D:\\Repos\\alpha', model = 'claude-opus-5-5' }) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(t).toISOString(),
    cwd,
    requestId: req,
    message: { id, model, usage: { input_tokens: 10, output_tokens: out, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000 } },
  }) + '\n';
}

function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'crabby-'));
  mkdirSync(path.join(root, 'proj', 'sess', 'subagents'), { recursive: true });
  return root;
}

test('counts each reply once, even when Claude Code repeats it per content block', async () => {
  const root = setup();
  writeFileSync(path.join(root, 'proj', 'a.jsonl'), reply({ id: 'm1' }) + reply({ id: 'm1' }) + reply({ id: 'm2', req: 'req_2' }));
  const logs = createLogTracker({ root, now: () => NOW });
  await logs.refresh();
  const s = logs.snapshot();
  assert.equal(s.today.replies, 2);
  assert.equal(s.today.output, 200);
  assert.equal(s.today.tokens, 2 * (10 + 100 + 1000 + 5000));
  assert.equal(s.last.project, 'alpha');
});

test('reads subagent logs and only the new bytes on the next scan', async () => {
  const root = setup();
  const file = path.join(root, 'proj', 'sess', 'subagents', 'agent-x.jsonl');
  writeFileSync(file, reply({ id: 'm1' }));
  const logs = createLogTracker({ root, now: () => NOW });
  await logs.refresh();
  assert.equal(logs.snapshot().today.replies, 1);
  appendFileSync(file, reply({ id: 'm2', req: 'r2', cwd: 'D:\\Repos\\beta' }));
  await logs.refresh();
  const s = logs.snapshot();
  assert.equal(s.today.replies, 2);
  assert.deepEqual(s.active.sort(), ['alpha', 'beta']);
});

test('leaves a half-written last line for the next scan', async () => {
  const root = setup();
  const file = path.join(root, 'proj', 'b.jsonl');
  const line = reply({ id: 'm9' });
  writeFileSync(file, line.slice(0, 40));
  const logs = createLogTracker({ root, now: () => NOW });
  await logs.refresh();
  assert.equal(logs.snapshot().today.replies, 0);
  appendFileSync(file, line.slice(40));
  await logs.refresh();
  assert.equal(logs.snapshot().today.replies, 1);
});

test('ignores replies older than a week and non-assistant lines', async () => {
  const root = setup();
  const old = reply({ id: 'old', t: NOW - 8 * 864e5 });
  const user = JSON.stringify({ type: 'user', timestamp: new Date(NOW).toISOString(), message: { usage: { output_tokens: 5 } } }) + '\n';
  writeFileSync(path.join(root, 'proj', 'c.jsonl'), old + user + 'not json "output_tokens"\n' + reply({ id: 'ok' }));
  const logs = createLogTracker({ root, now: () => NOW });
  await logs.refresh();
  const s = logs.snapshot();
  assert.equal(s.week.replies, 1);
  assert.equal(s.today.replies, 1);
});

test('names the project the session started in, not the subfolder the shell wandered into', () => {
  const cwd = path.join('D:' + path.sep, 'Repos', 'CrabbyBurner', 'public', 'fonts');
  assert.equal(projectName(cwd, 'd--Repos-CrabbyBurner'), 'CrabbyBurner');
  assert.equal(projectName(cwd, 'something-else'), 'fonts');
  assert.equal(projectName('', 'x'), null);
});

const SID = '4b74996a-b248-4768-b403-7a546ad0a1b5';
const RESET = NOW + 30 * 60e3;

function line(o) {
  return JSON.stringify({ isSidechain: false, sessionId: SID, cwd: 'D:\\Repos\\alpha', timestamp: new Date(NOW - 60e3).toISOString(), ...o }) + '\n';
}
const prompt = (text, extra) => line({ type: 'user', message: { role: 'user', content: text }, permissionMode: 'bypassPermissions', ...extra });
const answer = () => line({ type: 'assistant', message: { id: 'm' + Math.random(), model: 'claude-opus-5-5', usage: { output_tokens: 5 } } });
const limit = (resetsAt = RESET, extra) =>
  line({
    type: 'assistant',
    message: { id: 'x' + resetsAt, model: '<synthetic>', usage: { output_tokens: 0 }, content: [{ type: 'text', text: "You've hit your session limit" }] },
    quotaLimits: { status: 'rejected', resetsAt: resetsAt / 1000, rateLimitType: 'five_hour' },
    error: 'rate_limit',
    isApiErrorMessage: true,
    ...extra,
  });

async function stopsOf(root, text, file = path.join(root, 'proj', SID + '.jsonl')) {
  writeFileSync(file, text);
  const logs = createLogTracker({ root, now: () => NOW });
  await logs.refresh();
  return logs.stops();
}

test('a session that ends on the 5-hour limit reply is cut off until then', async () => {
  const [s, more] = await stopsOf(setup(), prompt('build it') + answer() + limit());
  assert.equal(more, undefined);
  assert.equal(s.sessionId, SID);
  assert.equal(s.resetsAt, RESET);
  assert.equal(s.cwd, 'D:\\Repos\\alpha');
  assert.equal(s.mode, 'bypassPermissions');
});

test('a cut-off session resumes from the folder it started in, not where the shell wandered', async () => {
  const root = setup();
  const wandered = path.join('D:' + path.sep, 'Repos', 'alpha', 'web');
  mkdirSync(path.join(root, 'D--Repos-alpha'));
  const [s] = await stopsOf(root, limit(RESET, { cwd: wandered }), path.join(root, 'D--Repos-alpha', SID + '.jsonl'));
  assert.equal(s.cwd, path.join('D:' + path.sep, 'Repos', 'alpha'));
  assert.equal(s.project, 'alpha');
});

test('a typed prompt or a real reply after the limit means the session went on', async () => {
  assert.deepEqual(await stopsOf(setup(), limit() + prompt('continue')), []);
  assert.deepEqual(await stopsOf(setup(), limit() + answer()), []);
  assert.deepEqual(await stopsOf(setup(), limit() + prompt([{ type: 'text', text: 'contiue' }])), []);
});

test('task notices, slash commands and meta lines do not count as taking over', async () => {
  const text =
    limit() +
    prompt('<task-notification>\n<task-id>abc</task-id>') +
    prompt('<command-name>/usage</command-name>') +
    prompt('Another Claude session sent a message', { isMeta: true }) +
    prompt([{ type: 'tool_result', content: 'ok' }]) +
    line({ type: 'queue-operation' });
  assert.equal((await stopsOf(setup(), text)).length, 1);
});

test('hitting the limit again moves the reset; subagents and the weekly limit do not cut a session off', async () => {
  const later = RESET + 5 * 3600e3;
  assert.equal((await stopsOf(setup(), limit() + prompt('continue') + limit(later)))[0].resetsAt, later);
  const root = setup();
  assert.deepEqual(await stopsOf(root, limit(RESET, { isSidechain: true }), path.join(root, 'proj', 'sess', 'subagents', 'agent-x.jsonl')), []);
  const weekly = limit(RESET, { quotaLimits: { status: 'rejected', resetsAt: RESET / 1000, rateLimitType: 'seven_day' } });
  assert.deepEqual(await stopsOf(setup(), weekly), []);
  assert.deepEqual(await stopsOf(setup(), limit() + weekly), []);
});

test('a missing log folder is an empty week, not a crash', async () => {
  const logs = createLogTracker({ root: path.join(os.tmpdir(), 'crabby-does-not-exist-' + Date.now()), now: () => NOW });
  await logs.refresh();
  const s = logs.snapshot();
  assert.equal(s.ready, true);
  assert.equal(s.today.tokens, 0);
  assert.equal(s.last, null);
});
