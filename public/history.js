/* The History sheet: weeks, days, projects and limit peaks from /api/history. */
(function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var EVERY = 60e3;

  function $(id) { return document.getElementById(id); }
  var sheet = $('history');
  var timer = 0;

  function compact(n) {
    var units = [['B', 1e9], ['M', 1e6], ['K', 1e3]];
    for (var i = 0; i < units.length; i++) {
      if (n >= units[i][1]) { var x = n / units[i][1]; return (x >= 100 ? x.toFixed(0) : x.toFixed(1)) + units[i][0]; }
    }
    return String(Math.round(n));
  }
  function parse(day) { var p = day.split('-'); return new Date(+p[0], p[1] - 1, +p[2]); }
  function short(day) { var d = parse(day); return d.getDate() + ' ' + MONTHS[d.getMonth()]; }

  // Bars scaled to the tallest; the current one orange, the record one marked.
  function bars(el, list, key, cur, best) {
    var max = Math.max.apply(null, list.map(function (x) { return x.tokens; })) || 1;
    el.textContent = '';
    list.forEach(function (x) {
      var i = document.createElement('i');
      i.style.height = (x.tokens ? Math.max(3, x.tokens / max * 100) : 0) + '%';
      i.className = (x[key] === cur ? 'cur' : '') + (best && x[key] === best ? ' best' : '');
      i.title = short(x[key]) + ': ' + compact(x.tokens) + ' tokens';
      el.appendChild(i);
    });
  }
  function axis(el, list, key) {
    el.textContent = '';
    [list[0], list[Math.floor(list.length / 2)], list[list.length - 1]].forEach(function (x) {
      var s = document.createElement('span');
      s.textContent = short(x[key]);
      el.appendChild(s);
    });
  }

  function rows(el, list, max, fmt) {
    el.textContent = '';
    if (!list.length) {
      var p = document.createElement('p');
      p.className = 'small';
      p.textContent = 'Nothing yet.';
      el.appendChild(p);
      return;
    }
    list.forEach(function (x) {
      var row = document.createElement('div');
      row.className = 'row';
      var name = document.createElement('span');
      name.className = 'row-name';
      name.textContent = x.label;
      var bar = document.createElement('span');
      bar.className = 'row-bar';
      var fill = document.createElement('i');
      fill.style.width = Math.max(2, x.value / max * 100) + '%';
      if (x.hot) fill.className = 'hot';
      bar.appendChild(fill);
      var val = document.createElement('b');
      val.textContent = fmt(x.value);
      row.appendChild(name);
      row.appendChild(bar);
      row.appendChild(val);
      el.appendChild(row);
    });
  }
  function projectRows(el, list) {
    var max = list.length ? list[0].tokens : 1;
    rows(el, list.slice(0, 5).map(function (p) { return { label: p.name, value: p.tokens }; }), max, compact);
  }

  function render(h) {
    $('hSince').textContent = h.since ? 'since ' + short(h.since) : '';

    var c = h.compare;
    var delta = $('hDelta');
    if (!h.ready) {
      delta.textContent = '–';
    } else if (!c.lastWeek) {
      delta.innerHTML = '<span class="pct">' + compact(c.thisWeek) + '</span> tokens';
    } else {
      var d = Math.round((c.thisWeek / c.lastWeek - 1) * 100);
      delta.innerHTML = '<span class="pct">' + (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d) + '%</span> ' + (d >= 0 ? 'more' : 'less');
    }
    if (h.ready) {
      $('hCompare').textContent = compact(c.thisWeek) + ' tokens this week so far, against ' + compact(c.lastWeek) +
        ' last week through ' + DAYS[c.weekday] + '. Last week in total: ' + compact(c.lastWeekTotal) + '.';
    }

    var thisWeek = h.weeks[h.weeks.length - 1].start;
    var bw = h.best.week, bd = h.best.day;
    bars($('hWeeks'), h.weeks, 'start', thisWeek, bw && bw.start);
    axis($('hWeeksAxis'), h.weeks, 'start');
    $('hBestWeek').innerHTML = bw ? 'Biggest week: <b>' + compact(bw.tokens) + '</b> from ' + short(bw.start) + (bw.start === thisWeek ? ' · that’s this week' : '') : '';

    bars($('hDays'), h.days, 'day', h.today, bd && bd.day);
    axis($('hDaysAxis'), h.days, 'day');
    $('hBestDay').innerHTML = bd ? 'Biggest day: <b>' + compact(bd.tokens) + '</b> on ' + short(bd.day) : '';

    projectRows($('hProjWeek'), h.projects.week);
    projectRows($('hProjAll'), h.projects.all);

    var lw = h.limitWeeks.slice().reverse();
    rows($('hLimits'), lw.map(function (w) {
      return { label: 'to ' + short(w.resetsAt.slice(0, 10)), value: w.peak, hot: w.peak >= 80 };
    }), 100, function (v) { return Math.round(v) + '%'; });
    $('hLimitsNote').textContent = lw.length < 2 ? 'Kept from the day CrabbyBurner started; Anthropic only tells the current week.' : '';
  }

  function load() {
    clearTimeout(timer);
    fetch('api/history', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { render(d.history); return d.history.ready; }, function () { return true; })
      .then(function (ready) {
        if (!sheet.hidden) timer = setTimeout(load, ready ? EVERY : 2000);
      });
  }

  function open() {
    sheet.hidden = false;
    load();
    $('histClose').focus();
  }
  function close() {
    sheet.hidden = true;
    clearTimeout(timer);
    $('histOpen').focus();
  }

  $('histOpen').addEventListener('click', open);
  $('histClose').addEventListener('click', close);
  document.querySelector('.card.today').addEventListener('click', open);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) close(); });
})();
