import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLimits, normalizeUsage, planLabel } from '../src/limits.mjs';
import { resolveStatic } from '../src/server.mjs';

const BODY = {
  five_hour: { utilization: 18, resets_at: '2026-10-04T21:40:00+00:00' },
  seven_day: { utilization: 62, resets_at: '2026-10-09T18:00:00+00:00' },
  limits: [
    { kind: 'session', percent: 18, severity: 'normal', resets_at: '2026-10-04T21:40:00+00:00' },
    { kind: 'weekly_all', percent: 62, severity: 'normal', resets_at: '2026-10-09T18:00:00+00:00' },
    { kind: 'weekly_scoped', percent: 0, resets_at: '2026-10-09T18:00:00+00:00', scope: { model: { display_name: 'Fable' } } },
  ],
};

function cred(extra) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'crabby-cred-'));
  const file = path.join(dir, '.credentials.json');
  writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: 'secret', rateLimitTier: 'default_claude_max_5x', subscriptionType: 'max', ...extra } }));
  return file;
}

test('normalizes the limits list, with the legacy fields as fallback', () => {
  const u = normalizeUsage(BODY);
  assert.deepEqual(u.session, { percent: 18, resetsAt: '2026-10-04T21:40:00+00:00', severity: 'normal' });
  assert.equal(u.weekly.percent, 62);
  assert.deepEqual(u.scoped, [{ label: 'Fable', percent: 0, resetsAt: '2026-10-09T18:00:00+00:00' }]);

  const legacy = normalizeUsage({ five_hour: BODY.five_hour, seven_day: BODY.seven_day });
  assert.equal(legacy.session.percent, 18);
  assert.equal(legacy.weekly.percent, 62);
});

test('labels the plan from the rate limit tier', () => {
  assert.equal(planLabel({ rateLimitTier: 'default_claude_max_20x' }), 'Max 20x');
  assert.equal(planLabel({ subscriptionType: 'pro' }), 'Pro');
  assert.equal(planLabel({}), null);
});

test('fetches with the local token and never exposes it', async () => {
  let seen;
  const limits = createLimits({
    credFile: cred({ expiresAt: Date.now() + 3600e3 }),
    fetchImpl: async (url, opts) => {
      seen = opts.headers.Authorization;
      return { ok: true, status: 200, json: async () => BODY };
    },
  });
  await limits.refresh();
  const s = limits.get();
  assert.equal(seen, 'Bearer secret');
  assert.equal(s.error, null);
  assert.equal(s.plan, 'Max 5x');
  assert.equal(s.session.percent, 18);
  assert.ok(!JSON.stringify(s).includes('secret'));
});

test('does not call out with an expired token', async () => {
  let calls = 0;
  const limits = createLimits({
    credFile: cred({ expiresAt: Date.now() - 1000 }),
    fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => BODY }; },
  });
  await limits.refresh();
  assert.equal(calls, 0);
  assert.equal(limits.get().error, 'expired');
});

test('keeps the last good numbers when the network drops', async () => {
  let up = true;
  let t = Date.now();
  const limits = createLimits({
    credFile: cred({ expiresAt: Date.now() + 3600e3 }),
    now: () => t,
    fetchImpl: async () => {
      if (!up) throw new Error('down');
      return { ok: true, status: 200, json: async () => BODY };
    },
  });
  await limits.refresh();
  up = false;
  t += 61e3;
  await limits.refresh();
  const s = limits.get();
  assert.equal(s.error, 'network');
  assert.equal(s.session.percent, 18);
});

test('static files cannot escape public/', () => {
  const root = path.resolve('public');
  assert.equal(resolveStatic('/', root), path.join(root, 'index.html'));
  assert.equal(resolveStatic('/app.js?v=2', root), path.join(root, 'app.js'));
  assert.equal(resolveStatic('/../src/limits.mjs', root), null);
  assert.equal(resolveStatic('/%2e%2e/%2e%2e/.claude/.credentials.json', root), null);
  assert.equal(resolveStatic('/..%5Csrc%5Cserver.mjs', root), null);
});
