import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHistory, dayKey, weekKey } from '../src/history.mjs';

// A Wednesday afternoon, local time.
const NOW = new Date(2026, 9, 7, 15, 0).getTime();
const DAY = 864e5;

function reply({ id, req = 'req_1', t = NOW - 60e3, out = 100, cwd = 'D:\\Repos\\alpha' }) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(t).toISOString(),
    cwd,
    requestId: req,
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  }) + '\n';
}

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'crabby-hist-'));
  const root = path.join(dir, 'projects');
  mkdirSync(path.join(root, 'proj'), { recursive: true });
  return { root, file: path.join(dir, 'history.json') };
}

test('weeks start on Monday', () => {
  assert.equal(weekKey('2026-10-07'), '2026-10-05');
  assert.equal(weekKey('2026-10-05'), '2026-10-05');
  assert.equal(weekKey('2026-10-04'), '2026-09-28');
});

test('adds up days, weeks and projects from every log, older than a week too', async () => {
  const { root, file } = setup();
  writeFileSync(
    path.join(root, 'proj', 'a.jsonl'),
    reply({ id: 'm1' }) +
      reply({ id: 'm1' }) +
      reply({ id: 'm2', req: 'r2', cwd: 'D:\\Repos\\beta' }) +
      reply({ id: 'm3', req: 'r3', t: NOW - 7 * DAY, out: 40 }) +
      reply({ id: 'm4', req: 'r4', t: NOW - 30 * DAY, out: 1000 }),
  );
  const h = createHistory({ root, file, now: () => NOW });
  await h.refresh();
  const s = h.snapshot();
  assert.equal(s.today, dayKey(NOW));
  assert.equal(s.days.at(-1).replies, 2);
  assert.equal(s.days.at(-1).tokens, 220);
  assert.equal(s.weeks.at(-1).start, '2026-10-05');
  assert.equal(s.weeks.at(-1).tokens, 220);
  assert.equal(s.compare.thisWeek, 220);
  assert.equal(s.compare.lastWeek, 50);
  assert.equal(s.compare.weekday, 2);
  assert.deepEqual(s.best.week, { start: weekKey(dayKey(NOW - 30 * DAY)), tokens: 1010 });
  assert.deepEqual(s.projects.week.map((p) => p.name).sort(), ['alpha', 'beta']);
  assert.equal(s.projects.all[0].name, 'alpha');
  assert.equal(s.since, dayKey(NOW - 30 * DAY));
});

test('keeps day totals when Claude Code deletes the logs', async () => {
  const { root, file } = setup();
  const log = path.join(root, 'proj', 'a.jsonl');
  writeFileSync(log, reply({ id: 'm1', t: NOW - 40 * DAY }));
  const first = createHistory({ root, file, now: () => NOW });
  await first.refresh();
  await first.save();
  unlinkSync(log);
  const second = createHistory({ root, file, now: () => NOW });
  await second.refresh();
  assert.equal(second.snapshot().best.day.tokens, 110);
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).days[dayKey(NOW - 40 * DAY)]);
});

test('does not count a day twice after a restart', async () => {
  const { root, file } = setup();
  writeFileSync(path.join(root, 'proj', 'a.jsonl'), reply({ id: 'm1' }));
  const first = createHistory({ root, file, now: () => NOW });
  await first.refresh();
  await first.save();
  const second = createHistory({ root, file, now: () => NOW });
  await second.refresh();
  assert.equal(second.snapshot().days.at(-1).tokens, 110);
});

test('remembers the highest limit percentages per day and per limit week', async () => {
  const { root, file } = setup();
  const h = createHistory({ root, file, now: () => NOW });
  const resetsAt = new Date(NOW + 3 * DAY).toISOString();
  h.noteLimits({ session: { percent: 80 }, weekly: { percent: 30, resetsAt } });
  h.noteLimits({ session: { percent: 10 }, weekly: { percent: 31, resetsAt } });
  h.noteLimits({ error: 'expired', session: { percent: 100 } });
  const s = h.snapshot();
  assert.equal(s.days.at(-1).session, 80);
  assert.equal(s.days.at(-1).weekly, 31);
  assert.deepEqual(s.limitWeeks, [{ resetsAt, peak: 31 }]);
});
