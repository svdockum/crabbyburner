/* Polls the PC every five seconds and puts the numbers on the cards and the stage. */
(function () {
  'use strict';

  var POLL = 5000;
  var MIN = 60e3;
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var ERR = {
    pending: ['Checking limits.', 'Asking Anthropic how much is left.'],
    'no-login': ['No login found.', 'Sign in to Claude Code on your PC to see plan limits.'],
    expired: ['Login expired.', 'Open Claude Code on your PC; it refreshes the login itself.'],
    network: ['Limits offline.', 'Could not reach Anthropic. Trying again in a minute.'],
    busy: ['Limits paused.', 'Anthropic asked for a breather. Back in a few minutes.'],
    http: ['Limits offline.', 'Anthropic answered oddly. Trying again in a minute.']
  };

  function $(id) { return document.getElementById(id); }
  var app = $('app');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stage = new window.CrabStage($('crab'));
  stage.start();
  $('markCrab').innerHTML = window.CrabSprite.svg({ eyes: 'open' });

  var skew = 0, data = null, failures = 0, timer = 0, entered = false, lastOk = 0;
  var prevPct = null, prevTokens = null, prevDay = null;
  var sessionAt = null, weekAt = null;

  function now() { return Date.now() + skew; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function compact(n) {
    var units = [['B', 1e9], ['M', 1e6], ['K', 1e3]];
    for (var i = 0; i < units.length; i++) {
      if (n >= units[i][1]) { var x = n / units[i][1]; return (x >= 100 ? x.toFixed(0) : x.toFixed(1)) + units[i][0]; }
    }
    return String(Math.round(n));
  }
  function grouped(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function span(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h >= 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
    if (h) return h + 'h ' + m + 'm';
    if (m >= 10) return m + 'm';
    return m + 'm ' + pad(s % 60) + 's';
  }
  function ago(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    return h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago';
  }
  function when(ts) {
    var ms = ts - now();
    return ms < 20 * 3600e3 ? 'in ' + span(ms) : DAYS[new Date(ts).getDay()] + ' ' + hm(new Date(ts));
  }
  function modelName(id) {
    var m = /claude-([a-z]+)-(\d+)-(\d+)/.exec(id || '');
    return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' ' + m[2] + '.' + m[3] : (id || '');
  }

  // Numbers count to their new value instead of jumping.
  function tween(el, to, fmt, ms) {
    var from = typeof el._v === 'number' ? el._v : 0;
    el._v = to;
    if (reduced || from === to) { setNum(el, fmt(to)); return; }
    var t0 = 0;
    function step(ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / ms);
      var e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
      setNum(el, fmt(from + (to - from) * e));
      if (k < 1 && el._v === to) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function pctText(v) { return Math.round(v) + '%'; }

  // Tabular digits keep ticking numbers still, but this face also widens
  // ":" "," "." under tnum, so only the digit runs get it.
  function setNum(el, text) {
    el.innerHTML = String(text).replace(/\d+/g, '<span class="tn">$&</span>');
  }

  /* ---------- build the fixed bits once ---------- */
  var bits = [], hours = [], i;
  for (i = 0; i < 20; i++) { bits.push(document.createElement('i')); $('wBits').appendChild(bits[i]); }
  for (i = 0; i < 24; i++) { hours.push(document.createElement('i')); $('tHours').appendChild(hours[i]); }

  /* ---------- render ---------- */

  function quipFor(p) {
    if (p < 1) return 'Fresh session. Nothing burned yet.';
    if (p < 30) return 'Plenty left in this session.';
    if (p < 60) return 'Cruising along.';
    if (p < 80) return 'Past halfway. Pace yourself.';
    if (p < 95) return 'Running hot. The crab is getting crabby.';
    if (p < 100) return 'Last few bites left.';
    return 'Cooked. The crab will wait.';
  }

  // What the PC does about sessions the limit cut off; it takes the quip's place.
  function who(list) {
    var names = list.map(function (x) { return x.project || 'a session'; });
    if (names.length === 1) return names[0];
    if (names.length === 2 && names[0] !== names[1]) return names[0] + ' and ' + names[1];
    return names.length + ' sessions';
  }
  function resumeNote(r) {
    var list = (r && r.sessions) || [];
    function of(st) { return list.filter(function (x) { return x.state === st; }); }
    var running = of('running'), stuck = of('stuck').concat(of('held')), waiting = of('waiting'), done = of('done');
    if (running.length) return 'Continuing ' + who(running) + '.';
    if (stuck.length) return who(stuck) + (stuck.length === 1 ? ' won’t continue by itself.' : ' won’t continue by themselves.');
    if (waiting.length) {
      var at = Math.min.apply(null, waiting.map(function (x) { return x.resetsAt; }));
      return who(waiting) + (waiting.length === 1 ? ' continues' : ' continue') + ' at ' + hm(new Date(at)) + '.';
    }
    var bad = done.filter(function (x) { return !x.ok; });
    if (bad.length) return 'Couldn’t continue ' + who(bad) + '. Details on the PC.';
    return done.length ? 'Picked up ' + who(done) + ' at ' + hm(new Date(done[0].at)) + '.' : '';
  }

  function headline(pct, err) {
    var h = $('headline');
    if (pct === null) {
      var e = ERR[err] || ERR.pending;
      h.className = 'text';
      h.textContent = e[0];
      $('quip').textContent = e[1];
      return;
    }
    if (!$('sPct')) {
      h.className = '';
      h.innerHTML = '<span class="pct" id="sPct">0%</span> burned<span class="pct">.</span>';
      fitHeadline();
    }
    tween($('sPct'), pct, pctText, 1100);
    $('quip').textContent = quipFor(pct);
  }

  // Size the headline so its widest form, "100% burned.", fits the block. CSS
  // sets the ceiling; this only ever shrinks it.
  var measure = document.createElement('canvas').getContext('2d');
  function fitHeadline() {
    var h = $('headline');
    h.style.fontSize = '';
    if (h.className === 'text') return;
    var css = parseFloat(window.getComputedStyle(h).fontSize);
    measure.font = '900 100px "Schibsted Grotesk", system-ui, sans-serif';
    var at100 = measure.measureText('100% burned.').width - 0.04 * 100 * 12;
    var fits = h.clientWidth / at100 * 100;
    if (fits < css) h.style.fontSize = Math.floor(fits) + 'px';
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHeadline);

  function fresh(lim, part) {
    return part && typeof part.percent === 'number' && (!lim.error || now() - lim.fetchedAt < 15 * MIN);
  }

  function render(d) {
    data = d;
    lastOk = Date.now();
    skew = d.now - Date.now();
    var lim = d.limits || {}, logs = d.logs || {};

    app.className = 'app live' + (entered ? '' : ' enter');
    if (!entered) { entered = true; setTimeout(function () { app.classList.remove('enter'); }, 1200); }
    var beat = $('beat');
    beat.className = '';
    void beat.offsetWidth;
    beat.className = 'beat';
    $('statusText').textContent = 'Live';
    $('plan').textContent = lim.plan || '';

    // Session
    var s = fresh(lim, lim.session) ? lim.session : null;
    var pct = s ? Math.round(s.percent) : null;
    headline(pct, lim.error);
    var note = resumeNote(d.resume);
    if (note) $('quip').textContent = note;
    sessionAt = s && s.resetsAt ? Date.parse(s.resetsAt) : null;
    stage.setBurn(pct === null ? null : pct / 100);
    if (prevPct !== null && pct !== null && pct < prevPct - 10) stage.celebrate();
    if (pct !== null) prevPct = pct;
    $('crab').setAttribute('aria-label', pct === null ? 'Session usage unknown' : 'Session ' + pct + '% burned');

    // Week
    var w = fresh(lim, lim.weekly) ? lim.weekly : null;
    var wp = w ? Math.round(w.percent) : null;
    if (wp === null) $('wPct').textContent = '–';
    else tween($('wPct'), wp, pctText, 900);
    var on = wp === null ? 0 : Math.min(20, Math.ceil(wp / 5));
    for (i = 0; i < 20; i++) {
      bits[i].className = i < on ? (i === on - 1 && wp < 100 ? 'edge' : 'on') + (wp >= 80 ? ' hot' : '') : '';
    }
    weekAt = w && w.resetsAt ? Date.parse(w.resetsAt) : null;
    var scoped = (lim.scoped || []).filter(function (x) { return typeof x.percent === 'number'; });
    $('wScoped').textContent = w ? scoped.map(function (x) { return x.label + ' ' + Math.round(x.percent) + '%'; }).join(' · ') : '';

    // Today
    var t = logs.today;
    if (logs.ready && t) {
      tween($('tTokens'), t.tokens, compact, 900);
      var max = Math.max.apply(null, t.hourly) || 1, hour = new Date(now()).getHours();
      for (i = 0; i < 24; i++) {
        var v = t.hourly[i];
        var sy = v ? Math.ceil(v / max * 6) / 6 : 0.08;
        hours[i].style.webkitTransform = hours[i].style.transform = 'scaleY(' + sy + ')';
        hours[i].className = i === hour ? 'cur' : v ? 'past' : '';
      }
      $('tReplies').innerHTML = '<b>' + grouped(t.replies) + '</b> replies · <b>' + compact(t.output) + '</b> output';
      var day = new Date(now()).getDate();
      if (prevTokens !== null && day === prevDay && t.tokens > prevTokens) {
        stage.feed(Math.max(1, Math.min(14, Math.round(Math.log(t.tokens - prevTokens) / Math.LN10 * 1.6))));
      }
      prevTokens = t.tokens; prevDay = day;
    } else {
      $('tReplies').textContent = 'Reading your logs…';
    }

    // Crab mood
    var last = logs.last;
    var lastAge = last ? now() - last.at : Infinity;
    var rpm = logs.pulse ? logs.pulse.replies2m / 2 : 0;
    stage.setMood({ sleepy: lastAge > 10 * MIN, rpm: rpm, pct: pct === null ? 0 : pct });
    tick();
  }

  function offline() {
    app.className = 'app offline';
    $('statusText').textContent = 'Offline';
    $('nowTab').className = 'tab ice';
    $('nowTab').textContent = 'No signal';
    $('nProject').textContent = 'Can’t reach your PC.';
    $('nMeta').textContent = 'Is it running?';
    $('nMore').textContent = '';
    // The numbers above are old now; say since when, and that we keep trying.
    $('quip').textContent = (lastOk ? 'Numbers from ' + hm(new Date(lastOk)) + '. ' : '') + 'Retrying.';
    stage.setMood({ sleepy: true, rpm: 0, pct: prevPct || 0 });
  }

  /* ---------- every second: clock and countdowns ---------- */

  function tick() {
    setNum($('clock'), hm(new Date(now())));
    if (!data || app.classList.contains('offline')) return;
    var lim = data.limits || {};
    if (sessionAt) {
      var full = prevPct !== null && prevPct >= 100;
      setNum($('sReset'), (full ? 'Back in ' : 'Resets in ') + span(sessionAt - now()));
      setNum($('sAt'), 'at ' + hm(new Date(sessionAt)));
    } else {
      $('sReset').textContent = lim.error ? 'Limits unavailable' : 'Resets in –';
      $('sAt').textContent = '';
    }
    $('wReset').textContent = weekAt ? 'Resets ' + when(weekAt) : '';

    var last = data.logs && data.logs.last;
    var tab = $('nowTab');
    if (!last) {
      tab.className = 'tab'; tab.textContent = 'Now';
      $('nProject').textContent = 'No replies this week yet.';
      $('nMeta').textContent = '';
      $('nMore').textContent = '';
      return;
    }
    var age = now() - last.at;
    if (age < 90e3) { tab.className = 'tab hot'; tab.textContent = 'Working'; }
    else if (age < 10 * MIN) { tab.className = 'tab'; tab.textContent = 'Idle'; }
    else { tab.className = 'tab ice'; tab.textContent = 'Asleep'; }
    var others = (data.logs.active || []).filter(function (p) { return p !== last.project; }).length;
    $('nProject').textContent = last.project || 'Claude Code';
    $('nMeta').textContent = '· ' + modelName(last.model) + ' · ' + ago(age);
    $('nMore').textContent = others ? ' · +' + others + ' more' : '';
  }

  /* ---------- polling ---------- */

  function poll() {
    clearTimeout(timer);
    var ctrl = window.AbortController ? new AbortController() : null;
    var kill = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : 0;
    fetch('api/usage', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { failures = 0; render(d); }, function () { if (++failures >= 2) offline(); })
      .then(function () {
        clearTimeout(kill);
        timer = setTimeout(poll, document.hidden ? 30000 : POLL);
      });
  }

  /* ---------- the phone as a desk display ---------- */

  var root = document.documentElement;
  var goFull = root.requestFullscreen || root.webkitRequestFullscreen;
  var fsBtn = $('fs');
  function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function syncFs() { fsBtn.hidden = !goFull || isFull(); }
  if (goFull) {
    fsBtn.addEventListener('click', function () { goFull.call(root); wake(); });
    document.addEventListener('fullscreenchange', syncFs);
    document.addEventListener('webkitfullscreenchange', syncFs);
  }
  syncFs();

  // Screen Wake Lock only exists on https or localhost; on the LAN the phone's
  // own "Stay awake" developer option does the job.
  var lock = null;
  function wake() {
    if (!navigator.wakeLock || lock) return;
    navigator.wakeLock.request('screen').then(function (l) {
      lock = l;
      l.addEventListener('release', function () { lock = null; });
    }, function () {});
  }
  document.addEventListener('click', wake);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    wake();
    stage.start();
    poll();
  });

  var resizeT = 0;
  function onResize() { clearTimeout(resizeT); resizeT = setTimeout(function () { stage.resize(); fitHeadline(); }, 120); }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.ResizeObserver) new ResizeObserver(onResize).observe($('stage'));

  // Nudge the whole sheet a pixel or two every few minutes so an always-on
  // OLED screen does not keep the same edges lit for hours.
  var shifts = [[0, 0], [2, 0], [2, 2], [0, 2], [-2, 2], [-2, 0], [-2, -2], [0, -2], [2, -2]], si = 0;
  setInterval(function () {
    si = (si + 1) % shifts.length;
    app.style.transform = 'translate(' + shifts[si][0] + 'px,' + shifts[si][1] + 'px)';
  }, 3 * MIN);

  setInterval(tick, 1000);
  tick();
  poll();
})();
