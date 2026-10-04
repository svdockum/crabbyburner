/* The stage: the 5-hour session drawn as a strip of sand that burns from the left,
   with pixel fire on the burned part and a crab living on it. New tokens fall in
   as food: into the fire they flare, on the sand the crab goes and eats them. */
(function () {
  'use strict';

  var Sprite = window.CrabSprite;
  var CW = Sprite.w, CH = Sprite.h;
  var MAXH = 12;
  var FIRE = ['', '#2B0E05', '#4A1707', '#7A230A', '#A8320B', '#C9400C', '#E5500E', '#F86415', '#FF7A2B', '#FF9447', '#FFB070', '#FFCB98', '#FFE6C8'];
  var FIRE_RGB = FIRE.map(function (h) {
    return h ? [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)] : [0, 0, 0];
  });
  var C = {
    sand: '#5A4434', sandDeep: '#33261D', speck: '#7A5F4C', tick: '#C9B8AC',
    ember: '#A8320B', hot: '#FF7A2B', edge: '#FFE6C8',
    token: '#FFC690', glint: '#FFFFFF', smoke: '#6B5F58', sweat: '#9CC7CE', z: '#9CC7CE', bang: '#FFE6C8', heart: '#FF9A55'
  };
  var GLYPH = {
    z: ['oooo', '..o.', '.o..', 'oooo'],
    bang: ['o', 'o', 'o', '.', 'o'],
    heart: ['.o.o.', 'ooooo', '.ooo.', '..o..']
  };

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(table) {
    var total = 0, i;
    for (i = 0; i < table.length; i++) total += table[i][1];
    var r = Math.random() * total;
    for (i = 0; i < table.length; i++) { r -= table[i][1]; if (r <= 0) return table[i][0]; }
    return table[0][0];
  }

  /* ---------- the crab ---------- */

  function Crab(stage) {
    this.s = stage;
    this.x = 4; this.jump = 0; this.vy = 0;
    this.state = 'idle'; this.t = 0; this.dur = 1.5;
    this.target = 0; this.speed = 12; this.legDist = 0; this.legs = 'a';
    this.eyes = 'open'; this.look = 'open'; this.blinkIn = 2; this.blinkLeft = 0;
    this.clawL = { shut: false, lift: 0 }; this.clawR = { shut: false, lift: 0 };
    this.tick = 0; this.food = null; this.hotT = 0; this.flash = 0;
  }

  Crab.prototype.center = function () { return this.x + CW / 2; };

  Crab.prototype.hop = function (v) { if (this.jump <= 0.01) this.vy = v; };

  Crab.prototype.go = function (state, arg) {
    var s = this.s, m = s.mood, maxX = Math.max(0, s.W - CW);
    this.state = state; this.t = 0; this.tick = 0; this.legDist = 0;
    this.clawL.lift = 0; this.clawR.lift = 0; this.clawL.shut = false; this.clawR.shut = false;
    this.look = 'open';
    var pace = m.pct >= 85 ? 26 : m.rpm >= 2 ? 20 : 12;
    switch (state) {
      case 'walk':
        this.speed = pace;
        this.target = this.coolSpot(maxX);
        this.dur = 12;
        break;
      case 'eat':
        this.food = arg; arg.claimed = true;
        this.speed = pace + 8;
        this.target = Math.max(0, Math.min(maxX, arg.x - CW / 2 + 1));
        this.dur = 12;
        break;
      case 'panic':
        this.speed = 44; this.target = rand(0, maxX); this.dur = rand(2.5, 3.5);
        break;
      case 'snap': this.dur = rand(0.8, 1.4); break;
      case 'dance': this.dur = arg || 2.8; break;
      case 'look': this.dur = 2; break;
      case 'wave': this.dur = 1.6; break;
      case 'wake':
        this.dur = 0.9; this.hop(42);
        s.burst('bang', this.center(), this.top() - 7, 1);
        break;
      case 'sleep': this.dur = 1e9; break;
      default: this.dur = rand(1.2, 3.2);
    }
  };

  // Crabs are not stupid: given the choice they walk where the sand is cold.
  Crab.prototype.coolSpot = function (maxX) {
    var edge = this.s.edgeX();
    if (edge > 0 && edge < maxX - 4 && Math.random() < 0.75) return rand(edge, maxX);
    return rand(0, maxX);
  };

  Crab.prototype.top = function () { return this.s.groundY - CH - Math.round(this.jump); };

  Crab.prototype.next = function () {
    var m = this.s.mood;
    if (m.sleepy) return this.go('sleep');
    if (this.s.reduced) return this.go(Math.random() < 0.6 ? 'idle' : 'look');
    var food = this.s.nearestToken(this.center());
    if (food && Math.random() < 0.9) return this.go('eat', food);
    var table = m.pct >= 85 ? [['panic', 3], ['snap', 3], ['walk', 3], ['idle', 1]]
      : m.rpm >= 2 ? [['walk', 5], ['snap', 2], ['idle', 2], ['dance', 1], ['look', 1]]
      : [['idle', 4], ['walk', 4], ['look', 2], ['snap', 1], ['dance', 1], ['wave', 1]];
    this.go(pick(table));
  };

  Crab.prototype.walkTo = function (dt) {
    var d = this.target - this.x;
    if (Math.abs(d) < 0.6) return true;
    var step = Math.min(Math.abs(d), this.speed * dt) * (d > 0 ? 1 : -1);
    this.x += step;
    this.legDist += Math.abs(step);
    if (this.legDist >= 1.6) { this.legDist = 0; this.legs = this.legs === 'a' ? 'b' : 'a'; }
    this.look = d > 0 ? 'right' : 'left';
    var bob = this.legs === 'a' ? 0 : 1;
    this.clawL.lift = bob; this.clawR.lift = 1 - bob;
    return false;
  };

  Crab.prototype.update = function (dt) {
    var s = this.s, m = s.mood;
    this.t += dt; this.tick += dt;

    if (this.jump > 0 || this.vy > 0) {
      this.vy -= 150 * dt; this.jump += this.vy * dt;
      if (this.jump <= 0) { this.jump = 0; this.vy = 0; }
    }
    if (m.sleepy && this.state !== 'sleep' && this.state !== 'wake' && this.state !== 'eat') this.go('sleep');
    if (!m.sleepy && this.state === 'sleep') this.go('wake');

    var done = this.t >= this.dur;
    switch (this.state) {
      case 'walk':
      case 'panic':
        if (this.walkTo(dt)) {
          if (this.state === 'panic' && !done) this.target = rand(0, Math.max(0, s.W - CW));
          else done = true;
        }
        if (this.state === 'panic') {
          this.look = 'shock'; this.clawL.lift = 1; this.clawR.lift = 1;
          if (this.tick > 0.22) { this.tick = 0; s.burst('sweat', this.center() + rand(-8, 8), this.top() + 3, 1); }
        }
        break;
      case 'eat':
        if (!this.food || this.food.gone) { done = true; break; }
        if (Math.abs(this.target - this.x) >= 0.6) { this.walkTo(dt); this.tick = 0; break; }
        this.legs = 'a'; this.look = 'open';
        var shut = Math.floor(this.tick / 0.13) % 2 === 1;
        this.clawL.shut = shut; this.clawR.shut = shut; this.clawL.lift = -1; this.clawR.lift = -1;
        if (this.tick > 0.55) {
          this.food.gone = true;
          s.burst('crumb', this.center(), s.groundY - 3, 5);
          s.burst('heart', this.center(), this.top() - 6, 1);
          this.hop(30);
          this.go('dance', 0.9);
          return;
        }
        break;
      case 'snap':
        var sh = Math.floor(this.tick / 0.12) % 2 === 1;
        if (sh && !this.clawL.shut) s.burst('spark', this.x + (Math.random() < 0.5 ? 2 : CW - 3), this.top() + 1, 2);
        this.clawL.shut = sh; this.clawR.shut = !sh; this.clawL.lift = 1; this.clawR.lift = 1;
        this.look = m.pct >= 85 ? 'angry' : 'open';
        break;
      case 'dance':
        if (this.tick > 0.36) { this.tick = 0; this.hop(34); this.legs = this.legs === 'a' ? 'b' : 'a'; }
        var up = this.legs === 'a';
        this.clawL.lift = up ? 1 : -1; this.clawR.lift = up ? -1 : 1;
        this.look = 'happy';
        break;
      case 'look':
        this.look = this.t < 0.7 ? 'left' : this.t < 1.4 ? 'right' : 'open';
        break;
      case 'wave':
        var right = this.center() < s.W / 2;
        var c = right ? this.clawR : this.clawL;
        c.lift = Math.floor(this.t / 0.2) % 2 ? 1 : 0; c.shut = Math.floor(this.t / 0.2) % 2 === 0;
        this.look = 'happy';
        break;
      case 'sleep':
        this.legs = 'none'; this.look = 'sleep';
        this.clawL.shut = true; this.clawR.shut = true; this.clawL.lift = -1; this.clawR.lift = -1;
        if (this.tick > 1.5) { this.tick = 0; s.burst('z', this.x + CW - 4, this.top() + 2, 1); }
        break;
      case 'wake':
        this.legs = 'a'; this.look = 'shock'; this.clawL.lift = 1; this.clawR.lift = 1;
        break;
      default:
        this.legs = 'a';
        if (this.tick > 1.1) { this.tick = 0; this.clawR.shut = Math.random() < 0.3; }
        this.look = m.pct >= 85 ? 'angry' : 'open';
    }
    if (this.state !== 'sleep' && this.legs === 'none') this.legs = 'a';

    // Hot feet: standing in the burned part makes the crab hop.
    var inFire = s.known && this.center() < s.edgeX() - 2 && this.state !== 'sleep';
    if (inFire) {
      this.hotT += dt;
      if (this.hotT > 0.5) {
        this.hotT = 0; this.hop(22); this.flash = 0.25;
        s.burst('smoke', this.center() + rand(-6, 6), s.groundY - 1, 2);
      }
    } else this.hotT = 0;

    // Blinking, unless the eyes are busy saying something else.
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) { this.blinkLeft = 0.13; this.blinkIn = rand(2, 5.5); }
    this.blinkLeft -= dt;
    this.flash -= dt;
    this.eyes = this.flash > 0 ? 'shock' : this.blinkLeft > 0 && this.look !== 'sleep' && this.look !== 'happy' ? 'blink' : this.look;

    if (done && this.state !== 'sleep') this.next();
  };

  Crab.prototype.draw = function (ctx) {
    var px = Sprite.pixels({ legs: this.legs, eyes: this.eyes, clawL: this.clawL, clawR: this.clawR });
    var ox = Math.round(this.x), oy = this.s.groundY - CH - Math.round(this.jump);
    var col = Sprite.colors;
    for (var i = 0; i < px.length; i++) {
      ctx.fillStyle = col[px[i][2]];
      ctx.fillRect(ox + px[i][0], oy + px[i][1], 1, 1);
    }
  };

  /* ---------- the stage ---------- */

  function Stage(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = 0; this.H = 0; this.px = 4; this.groundY = 0;
    this.burn = 0; this.target = 0; this.known = false;
    this.mood = { sleepy: true, rpm: 0, pct: 0 };
    this.parts = []; this.tokens = [];
    this.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.crab = new Crab(this);
    this.crab.go('sleep');
    this.last = 0; this.acc = 0; this.raf = 0;
    this.resize();
    var self = this;
    this.loop = function (ts) { self.frame(ts); };
    canvas.parentNode.addEventListener('click', function (e) { self.poke(e); });
  }

  Stage.prototype.resize = function () {
    var box = this.c.parentNode, w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    var px = Math.max(3, Math.min(8, Math.round(Math.min(w / 64, h / 36))));
    var W = Math.floor(w / px), H = Math.max(CH + 6, Math.floor(h / px));
    if (W === this.W && H === this.H && px === this.px) return;
    this.px = px; this.W = W; this.H = H;
    this.groundY = H - 2;
    this.c.width = W; this.c.height = H;
    this.c.style.width = W * px + 'px'; this.c.style.height = H * px + 'px';
    this.fireH = H - 2;
    this.heat = new Uint8Array(W * this.fireH);
    this.flare = new Uint8Array(W);
    this.img = this.ctx.createImageData(W, this.fireH);
    this.crab.x = Math.min(this.crab.x, Math.max(0, W - CW));
  };

  Stage.prototype.edgeX = function () { return Math.round(this.burn * this.W); };

  Stage.prototype.setBurn = function (frac) {
    if (frac === null || frac === undefined) { this.known = false; return; }
    this.known = true;
    this.target = Math.max(0, Math.min(1, frac));
    if (this.reduced) this.burn = this.target;
  };

  Stage.prototype.setMood = function (m) { this.mood = m; };

  // Flame height follows how fast Claude is replying right now: embers when
  // quiet, up to two thirds of the stage when replies are pouring in.
  Stage.prototype.decayFor = function () {
    var act = Math.min(this.mood.rpm || 0, 6) / 6;
    var rows = Math.max(3, this.fireH * (0.14 + 0.52 * act));
    return 1 + 2 * MAXH / rows;
  };

  Stage.prototype.feed = function (n) {
    if (this.reduced || !this.W) return;
    n = Math.min(n, 14);
    for (var i = 0; i < n; i++) {
      this.tokens.push({ x: Math.floor(rand(1, this.W - 3)), y: -rand(2, 18), vy: rand(0, 10), ground: false, life: 30, claimed: false, gone: false });
    }
  };

  Stage.prototype.nearestToken = function (x) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.tokens.length; i++) {
      var t = this.tokens[i];
      if (!t.ground || t.claimed || t.gone) continue;
      var d = Math.abs(t.x - x);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  };

  Stage.prototype.celebrate = function () {
    this.crab.go('dance', 5);
    var colors = ['#FF6A13', '#FFC690', '#9CC7CE', '#FFFFFF', '#FF9A55'];
    for (var i = 0; i < 46; i++) {
      this.parts.push({ k: 'confetti', x: this.crab.center(), y: this.crab.top(), vx: rand(-40, 40), vy: rand(-70, -25), life: rand(1.4, 2.4), max: 2.4, color: colors[i % colors.length] });
    }
  };

  // Tap the stage: wake the crab, or drop a token where you tapped.
  Stage.prototype.poke = function (e) {
    var rect = this.c.getBoundingClientRect();
    var x = (e.clientX - rect.left) / this.px;
    if (this.crab.state === 'sleep') { this.crab.go('wake'); return; }
    if (Math.abs(x - this.crab.center()) < CW / 2 + 1) { this.crab.go('wake'); return; }
    this.tokens.push({ x: Math.max(1, Math.min(this.W - 3, Math.floor(x))), y: -2, vy: 0, ground: false, life: 30, claimed: false, gone: false });
  };

  Stage.prototype.burst = function (k, x, y, n) {
    if (this.reduced && k !== 'z') return;
    for (var i = 0; i < n; i++) {
      var p = { k: k, x: x, y: y, vx: 0, vy: 0, life: 1, max: 1, g: 0 };
      if (k === 'spark') { p.vx = rand(-30, 30); p.vy = rand(-40, -10); p.g = 120; p.life = p.max = 0.35; p.color = C.edge; }
      else if (k === 'smoke') { p.vx = rand(-4, 4); p.vy = rand(-14, -8); p.life = p.max = 0.9; p.color = C.smoke; }
      else if (k === 'sweat') { p.vx = rand(-26, 26); p.vy = rand(-34, -16); p.g = 130; p.life = p.max = 0.6; p.color = C.sweat; }
      else if (k === 'crumb') { p.vx = rand(-24, 24); p.vy = rand(-30, -10); p.g = 140; p.life = p.max = 0.5; p.color = C.token; }
      else if (k === 'z') { p.vx = 3; p.vy = -5; p.life = p.max = 3; p.color = C.z; }
      else if (k === 'bang') { p.life = p.max = 0.8; p.color = C.bang; }
      else if (k === 'heart') { p.vy = -10; p.life = p.max = 1; p.color = C.heart; }
      this.parts.push(p);
    }
  };

  Stage.prototype.fireStep = function () {
    var W = this.W, H = this.fireH, heat = this.heat, x, i;
    var edge = this.known ? this.edgeX() : 0;
    var base = (H - 1) * W;
    for (x = 0; x < W; x++) {
      // The last few burned columns run cooler, so the fire front slopes.
      var v = x < edge ? MAXH - (Math.random() < 0.2 ? 1 : 0) - Math.max(0, 4 - (edge - x)) : 0;
      if (this.flare[x]) { v = MAXH; this.flare[x]--; }
      heat[base + x] = v;
    }
    var d = this.decayFor();
    for (var y = 1; y < H; y++) {
      for (x = 0; x < W; x++) {
        i = y * W + x;
        var p = heat[i];
        if (!p) { heat[i - W] = 0; continue; }
        // A light wind toward the cold sand: flames lick at the crab's side.
        var q = Math.random(), r = q < 0.42 ? 0 : q < 0.77 ? 1 : 2;
        var nx = x - r + 1;
        var dst = (nx < 0 || nx >= W) ? i - W : i - W - r + 1;
        var dec = (Math.random() * (this.flare[x] ? 1.6 : d)) | 0;
        heat[dst] = p > dec ? p - dec : 0;
      }
    }
  };

  Stage.prototype.update = function (dt) {
    // The burn front eases toward the real number: ignition on load, retreat on reset.
    var diff = this.target - this.burn;
    if (Math.abs(diff) > 0.001) this.burn += diff * Math.min(1, dt * 2.6);
    else this.burn = this.target;
    if (!this.reduced) this.fireStep();

    var edge = this.known ? this.edgeX() : 0, i;
    for (i = this.tokens.length - 1; i >= 0; i--) {
      var t = this.tokens[i];
      if (!t.ground) {
        t.vy += 70 * dt; t.y += t.vy * dt;
        if (t.y >= this.groundY - 2) {
          if (t.x < edge) {
            this.flare[t.x] = 7; if (t.x + 1 < this.W) this.flare[t.x + 1] = 7;
            this.burst('spark', t.x, this.groundY - 3, 3);
            t.gone = true;
          } else { t.ground = true; t.y = this.groundY - 2; }
        }
      } else {
        t.life -= dt;
        if (t.x < edge) t.gone = true; // the fire reached it
      }
      if (t.gone || t.life <= 0) this.tokens.splice(i, 1);
    }
    if (this.tokens.length > 24) this.tokens.splice(0, this.tokens.length - 24);

    for (i = this.parts.length - 1; i >= 0; i--) {
      var p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vy += (p.g || (p.k === 'confetti' ? 90 : 0)) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 'confetti' && p.y > this.groundY - 1) { p.y = this.groundY - 1; p.vx *= 0.6; p.vy = 0; }
    }
    this.crab.update(dt);
  };

  Stage.prototype.draw = function () {
    var ctx = this.ctx, W = this.W, H = this.H, x, i;
    if (this.reduced || !this.known) {
      ctx.clearRect(0, 0, W, H);
    } else {
      var data = this.img.data, heat = this.heat;
      for (i = 0; i < heat.length; i++) {
        var o = i * 4, v = heat[i];
        if (!v) { data[o + 3] = 0; continue; }
        var c = FIRE_RGB[v];
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
      }
      ctx.putImageData(this.img, 0, 0);
      ctx.clearRect(0, this.fireH, W, H - this.fireH);
    }

    // The floor is the meter: burned sand on the left, cold sand on the right.
    var edge = this.known ? this.edgeX() : 0, gy = this.groundY;
    for (x = 0; x < W; x++) {
      var burned = x < edge;
      ctx.fillStyle = burned ? (x % 3 === 0 ? C.hot : '#F86415') : (x % 7 === 3 ? C.speck : C.sand);
      ctx.fillRect(x, gy, 1, 1);
      ctx.fillStyle = burned ? C.ember : C.sandDeep;
      ctx.fillRect(x, gy + 1, 1, 1);
    }
    ctx.fillStyle = C.tick;
    for (var q = 1; q < 4; q++) ctx.fillRect(Math.round(W * q / 4), gy + 1, 1, 1);
    if (this.known && edge > 0 && edge < W) {
      ctx.fillStyle = Math.random() < 0.7 ? C.edge : C.hot;
      ctx.fillRect(edge - 1, gy, 1, 1);
    }

    for (i = 0; i < this.tokens.length; i++) {
      var t = this.tokens[i], ty = Math.round(t.y);
      ctx.fillStyle = C.token; ctx.fillRect(t.x, ty, 2, 2);
      ctx.fillStyle = t.ground && (Date.now() / 400 + t.x) % 3 < 0.4 ? C.glint : C.edge;
      ctx.fillRect(t.x, ty, 1, 1);
    }

    this.crab.draw(ctx);

    for (i = 0; i < this.parts.length; i++) {
      var p = this.parts[i], px = Math.round(p.x), py = Math.round(p.y);
      ctx.globalAlpha = p.k === 'smoke' || p.k === 'z' ? Math.max(0, p.life / p.max) : 1;
      ctx.fillStyle = p.color;
      var g = GLYPH[p.k];
      if (g) {
        for (var r = 0; r < g.length; r++) {
          for (var k = 0; k < g[r].length; k++) if (g[r].charAt(k) === 'o') ctx.fillRect(px - (g[r].length >> 1) + k, py + r, 1, 1);
        }
      } else ctx.fillRect(px, py, 1, 1);
    }
    ctx.globalAlpha = 1;
  };

  Stage.prototype.frame = function (ts) {
    this.raf = 0;
    if (document.hidden) return;
    var step = this.reduced ? 250 : 50;
    if (!this.last) this.last = ts;
    this.acc += Math.min(ts - this.last, 500);
    this.last = ts;
    if (this.acc >= step) {
      var dt = Math.min(this.acc, 200) / 1000;
      this.acc = 0;
      this.update(dt);
      this.draw();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  Stage.prototype.start = function () {
    if (!this.raf && !document.hidden) { this.last = 0; this.raf = requestAnimationFrame(this.loop); }
  };

  window.CrabStage = Stage;
})();
