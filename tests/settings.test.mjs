import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createDoor, createSettings } from '../src/settings.mjs';
import { createApp } from '../src/server.mjs';

const SID = '4b74996a-b248-4768-b403-7a546ad0a1b5';
const tmp = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'crabby-set-')), 'settings.json');
const settle = () => new Promise((res) => setTimeout(res, 30));

test('starts on all sessions with a fresh six-digit code, and keeps both', async () => {
  const file = tmp();
  const a = createSettings({ file });
  assert.equal(a.get().mode, 'all');
  assert.match(a.get().code, /^\d{6}$/);
  await a.setMode('pick');
  await a.pick(SID, true);
  const b = createSettings({ file });
  assert.deepEqual(b.get(), a.get());
  b.prune(new Set());
  await settle();
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).picks, {});
});

test('a broken settings file falls back to the defaults', () => {
  const file = tmp();
  writeFileSync(file, '{"mode":"sometimes","picks":{"x":"yes"},"code":"12"');
  const s = createSettings({ file }).get();
  assert.equal(s.mode, 'all');
  assert.deepEqual(s.picks, {});
  assert.match(s.code, /^\d{6}$/);
});

test('five wrong codes lock changes for ten minutes, even for the right code', () => {
  const clock = { t: 0 };
  const door = createDoor({ code: () => '123456', now: () => clock.t });
  assert.equal(door('123456'), 'ok');
  for (let i = 0; i < 5; i++) assert.equal(door('000000'), 'wrong');
  assert.equal(door('123456'), 'locked');
  clock.t += 11 * 60e3;
  assert.equal(door('123456'), 'ok');
  assert.equal(door(undefined), 'wrong');
});

test('the phone can change the setting only with the code', async () => {
  const settings = createSettings({ file: tmp() });
  const logs = {
    refresh: async () => {},
    isReady: () => true,
    snapshot: () => ({}),
    stops: () => [],
    sessions: () => [{ sessionId: SID, project: 'alpha', lastAt: Date.now() }],
  };
  const server = createApp({ logs, limits: { refresh() {}, get: () => ({}) }, settings });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const url = `http://127.0.0.1:${server.address().port}/api/resume`;
  const post = (body, code = settings.get().code) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Crabby-Code': code }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ mode: 'off' }, '000000')).status, 403);
    assert.equal(settings.get().mode, 'all');

    const ok = await post({ mode: 'pick' });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).resume.mode, 'pick');

    const picked = await (await post({ session: SID, auto: true })).json();
    assert.deepEqual(picked.resume.sessions.map((s) => [s.id, s.auto, s.pick]), [[SID, true, true]]);

    assert.equal((await post({ session: 'not-there', auto: true })).status, 404);
    assert.equal((await post({ mode: 'always' })).status, 400);
    assert.equal((await post({ session: SID, auto: 'yes' })).status, 400);
    assert.equal((await post({ session: SID, now: true })).status, 409);
    assert.equal((await post({})).status, 200);
    assert.equal((await fetch(url)).status, 404);
  } finally {
    server.close();
  }
});
