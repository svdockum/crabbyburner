import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createResumer, resumeArgs } from '../src/resume.mjs';

const MIN = 60e3;
const RESET = Date.parse('2026-10-04T21:30:00Z');
const SID = '4b74996a-b248-4768-b403-7a546ad0a1b5';
const OTHER = '990b7349-5fc7-46f5-9b0b-d211266b9750';

function stop(extra) {
  return { sessionId: SID, cwd: os.tmpdir(), project: 'alpha', at: RESET - 2 * 3600e3, resetsAt: RESET, mode: 'bypassPermissions', ...extra };
}

function fakeSettings(mode = 'all', picks = {}) {
  const s = { mode, picks, code: '123456' };
  return {
    get: () => s,
    setMode: (m) => (s.mode = m),
    pick: (id, a) => (a === null ? delete s.picks[id] : (s.picks[id] = a)),
    prune: () => {},
  };
}

function setup({ stops = [stop()], sessions = [], ok = true, mode, picks, ...opts } = {}) {
  const clock = { t: RESET - MIN };
  const calls = [];
  const settings = fakeSettings(mode, picks);
  const r = createResumer({
    stops: () => stops,
    sessions: () => sessions,
    settings,
    now: () => clock.t,
    run: async (s) => {
      calls.push(s);
      return ok ? { ok: true } : { ok: false, error: 'boom' };
    },
    ...opts,
  });
  const row = (id = SID) => r.status().sessions.find((x) => x.id === id);
  return { r, clock, calls, settings, row, settle: () => new Promise((res) => setTimeout(res, 20)) };
}

test('resumes a cut-off session a minute after the reset, once', async () => {
  const { r, clock, calls, row, settle } = setup();
  r.tick();
  clock.t = RESET + 30e3;
  r.tick();
  assert.equal(calls.length, 0);
  assert.equal(row().state, 'waiting');
  assert.equal(row().resetsAt, RESET);

  clock.t = RESET + MIN;
  r.tick();
  r.tick();
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, SID);
});

test('shows a resume as running, then as picked up for an hour', async () => {
  let finish;
  const stops = [stop()];
  const { r, clock, row } = setup({ stops, run: () => new Promise((res) => (finish = res)) });
  clock.t = RESET + MIN;
  r.tick();
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(row().state, 'running');
  stops.length = 0; // the resume wrote "continue", so the log no longer ends cut off
  finish({ ok: true });
  await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual([row().state, row().ok, row().at], ['done', true, RESET + MIN]);
  clock.t += 61 * MIN;
  assert.equal(row(), undefined);
});

test('in pick mode only switched-on sessions continue; in all mode a switched-off one stays put', async () => {
  for (const [mode, picks, runs, state] of [
    ['pick', {}, 0, 'held'],
    ['pick', { [SID]: true }, 1, null],
    ['all', { [SID]: false }, 0, 'held'],
    ['off', { [SID]: true }, 0, 'held'],
  ]) {
    const { r, clock, calls, row, settle } = setup({ mode, picks });
    if (state) assert.equal(row().state, state, `${mode} ${JSON.stringify(picks)}`);
    clock.t = RESET + MIN;
    r.tick();
    await settle();
    assert.equal(calls.length, runs, `${mode} ${JSON.stringify(picks)}`);
  }
});

test('says why a cut-off session will not continue by itself', async () => {
  const late = setup();
  late.clock.t = RESET + 3 * 3600e3 + 1;
  late.r.tick();
  await late.settle();
  assert.equal(late.calls.length, 0);
  assert.deepEqual([late.row().state, late.row().reason], ['stuck', 'late']);

  const failed = setup({ ok: false });
  failed.clock.t = RESET + MIN;
  failed.r.tick();
  await failed.settle();
  assert.deepEqual([failed.row().state, failed.row().reason, failed.row().error], ['stuck', 'failed', 'boom']);

  const stops = [stop()];
  const capped = setup({ stops });
  for (let i = 0; i < 4; i++) {
    const reset = RESET + i * 5 * 3600e3;
    stops[0] = stop({ resetsAt: reset });
    capped.clock.t = reset + MIN;
    capped.r.tick();
    await capped.settle();
  }
  assert.equal(capped.calls.length, 3);
  assert.deepEqual([capped.row().state, capped.row().reason], ['stuck', 'tries']);
});

test('continue now goes past the tries and the grace period, but not past the limit', async () => {
  const { r, clock, calls, settle } = setup({ mode: 'off' });
  assert.equal(r.continueNow(SID), 'limit');
  clock.t = RESET + 5 * 3600e3;
  assert.equal(r.continueNow(SID), 'ok');
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(r.continueNow(OTHER), 'gone');
  assert.equal(setup({ full: () => true, clock: undefined }).r.continueNow(SID), 'limit');
});

test('lists recent sessions so they can be picked ahead, most pressing first', () => {
  const sessions = [
    { sessionId: OTHER, project: 'beta', lastAt: RESET - 2 * MIN },
    { sessionId: 'old', project: 'gamma', lastAt: RESET - 4 * 3600e3 },
  ];
  const { r } = setup({ sessions, mode: 'pick', picks: { [OTHER]: true } });
  const list = r.status().sessions;
  assert.deepEqual(
    list.map((x) => [x.project, x.state, x.auto, x.pick]),
    [
      ['alpha', 'held', false, null],
      ['beta', 'active', true, true],
    ],
  );
  assert.equal(r.status().mode, 'pick');
  assert.ok(r.knows(OTHER) && r.knows(SID) && !r.knows('nope'));
});

test('does nothing while the limits still say used up', async () => {
  const { r, clock, calls, settle } = setup({ full: () => true });
  clock.t = RESET + 2 * MIN;
  r.tick();
  await settle();
  assert.equal(calls.length, 0);
});

test('a session whose folder is gone, or an odd id, fails without running Claude', async () => {
  const { r, clock, calls, settle } = setup({
    stops: [stop({ cwd: os.tmpdir() + '/crabby-gone-' + Date.now() }), stop({ sessionId: 'x & calc', project: 'beta' })],
  });
  clock.t = RESET + MIN;
  r.tick();
  await settle();
  assert.equal(calls.length, 0);
  assert.deepEqual(
    r.status().sessions.map((d) => d.reason),
    ['failed', 'failed'],
  );
});

test('resumes in the mode the session ran in, and only a known one', () => {
  assert.deepEqual(resumeArgs(stop()), ['-p', '--resume', SID, '--permission-mode', 'bypassPermissions', 'continue']);
  assert.deepEqual(resumeArgs(stop({ mode: 'evil && rm' })), ['-p', '--resume', SID, 'continue']);
  assert.deepEqual(resumeArgs(stop({ mode: null })), ['-p', '--resume', SID, 'continue']);
});
