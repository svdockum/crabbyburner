// Fetches the plan limits (5-hour session, weekly) that Claude Code's /usage shows,
// using the OAuth login Claude Code keeps on this PC. The token is read fresh on
// every call and never logged, returned or refreshed here: refreshing would rotate
// it out from under Claude Code itself.
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const MIN = 60e3;

export function defaultCredFile() {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

export function planLabel(cred) {
  const tier = String((cred && cred.rateLimitTier) || '');
  const max = tier.match(/max_(\d+x)/i);
  if (max) return 'Max ' + max[1].toLowerCase();
  const sub = String((cred && cred.subscriptionType) || '');
  return sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : null;
}

export function normalizeUsage(body) {
  const limits = body && Array.isArray(body.limits) ? body.limits : [];
  const pick = (kind, legacy) => {
    const l = limits.find((x) => x && x.kind === kind);
    if (l) return { percent: num(l.percent), resetsAt: l.resets_at || null, severity: l.severity || null };
    const f = body && body[legacy];
    return f ? { percent: num(f.utilization), resetsAt: f.resets_at || null, severity: null } : null;
  };
  return {
    session: pick('session', 'five_hour'),
    weekly: pick('weekly_all', 'seven_day'),
    scoped: limits
      .filter((l) => l && l.kind === 'weekly_scoped')
      .map((l) => ({
        label: (l.scope && l.scope.model && l.scope.model.display_name) || 'Model',
        percent: num(l.percent),
        resetsAt: l.resets_at || null,
      })),
  };
}

export function createLimits({ credFile = defaultCredFile(), fetchImpl = globalThis.fetch, now = Date.now, every = MIN } = {}) {
  let state = { error: 'pending', fetchedAt: 0, plan: null, session: null, weekly: null, scoped: [] };
  let nextAt = 0;
  let running = null;

  function fail(error, retryIn) {
    state = { ...state, error };
    nextAt = now() + retryIn;
  }

  async function load() {
    let cred;
    try {
      cred = JSON.parse(await fsp.readFile(credFile, 'utf8')).claudeAiOauth;
    } catch {
      return fail('no-login', 5 * MIN);
    }
    if (!cred || !cred.accessToken) return fail('no-login', 5 * MIN);
    state = { ...state, plan: planLabel(cred) };
    // Claude Code refreshes its own token while it runs; check back soon.
    if (cred.expiresAt && cred.expiresAt < now()) return fail('expired', 30e3);

    let res;
    try {
      res = await fetchImpl(ENDPOINT, {
        headers: { Authorization: 'Bearer ' + cred.accessToken, 'anthropic-beta': 'oauth-2025-04-20' },
        signal: AbortSignal.timeout(10e3),
      });
    } catch {
      return fail('network', MIN);
    }
    if (res.status === 401 || res.status === 403) return fail('expired', MIN);
    if (res.status === 429) return fail('busy', 5 * MIN);
    if (!res.ok) return fail('http', MIN);

    let body;
    try {
      body = await res.json();
    } catch {
      return fail('http', MIN);
    }
    state = { ...state, ...normalizeUsage(body), error: null, fetchedAt: now() };
    nextAt = now() + every;
  }

  function refresh() {
    if (!running && now() >= nextAt) running = load().finally(() => (running = null));
    return running || Promise.resolve();
  }

  return { refresh, get: () => state };
}
