// The stage: the 5-hour session drawn as a strip of sand that burns from the
// left, with pixel fire on the burned part and a crab living on it. New tokens
// fall in as food: into the fire they flare, on the sand the crab eats them.
// Pure logic in logical pixels; StageView paints it.
import 'dart:math';
import 'dart:typed_data';
import 'dart:ui';

import 'crab.dart';
import 'sprite.dart';

const int maxHeat = 12;

const fireColors = [
  Color(0x00000000), Color(0xFF2B0E05), Color(0xFF4A1707), Color(0xFF7A230A),
  Color(0xFFA8320B), Color(0xFFC9400C), Color(0xFFE5500E), Color(0xFFF86415),
  Color(0xFFFF7A2B), Color(0xFFFF9447), Color(0xFFFFB070), Color(0xFFFFCB98),
  Color(0xFFFFE6C8),
];

enum Kind { spark, smoke, sweat, crumb, z, bang, heart, confetti }

const glyphs = {
  Kind.z: ['oooo', '..o.', '.o..', 'oooo'],
  Kind.bang: ['o', 'o', 'o', '.', 'o'],
  Kind.heart: ['.o.o.', 'ooooo', '.ooo.', '..o..'],
};

class Mood {
  final bool sleepy;
  final double rpm;
  final int pct;
  const Mood({this.sleepy = true, this.rpm = 0, this.pct = 0});
}

class Token {
  Token(this.x, this.y, this.vy);
  final int x;
  double y, vy;
  bool ground = false, claimed = false, gone = false;
  double life = 30;
}

class Particle {
  Particle(this.kind, this.x, this.y, this.color);
  final Kind kind;
  double x, y, vx = 0, vy = 0, g = 0, life = 1, max = 1;
  Color color;
}

class Stage {
  Stage({Random? random}) : r = random ?? Random() {
    crab = Crab(this);
  }

  final Random r;
  late final Crab crab;

  int w = 0, h = 0, groundY = 0, fireH = 0;
  Uint8List heat = Uint8List(0), flare = Uint8List(0);
  double burn = 0, target = 0;
  bool known = false, reduced = false;
  Mood mood = const Mood();
  final parts = <Particle>[];
  final tokens = <Token>[];

  double rand(double a, double b) => a + r.nextDouble() * (b - a);
  int get edgeX => (burn * w).round();

  void resize(int width, int height) {
    width = max(width, CrabSprite.w + 2);
    height = max(height, CrabSprite.h + 6);
    if (width == w && height == h) return;
    w = width;
    h = height;
    groundY = h - 2;
    fireH = h - 2;
    heat = Uint8List(w * fireH);
    flare = Uint8List(w);
    crab.x = min(crab.x, max(0, w - CrabSprite.w).toDouble());
  }

  void setBurn(double? frac) {
    if (frac == null) {
      known = false;
      return;
    }
    known = true;
    target = frac.clamp(0.0, 1.0);
    if (reduced) burn = target;
  }

  void feed(int n) {
    if (reduced || w == 0) return;
    for (var i = 0; i < min(n, 14); i++) {
      tokens.add(Token(rand(1, w - 3).floor(), -rand(2, 18), rand(0, 10)));
    }
  }

  Token? nearestToken(double x) {
    Token? best;
    var bd = double.infinity;
    for (final t in tokens) {
      if (!t.ground || t.claimed || t.gone) continue;
      final d = (t.x - x).abs();
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  void celebrate() {
    crab.go(Act.dance, length: 5);
    const colors = [Color(0xFFFF6A13), Color(0xFFFFC690), Color(0xFF9CC7CE), Color(0xFFFFFFFF), Color(0xFFFF9A55)];
    for (var i = 0; i < 46; i++) {
      final m = rand(1.4, 2.4);
      parts.add(Particle(Kind.confetti, crab.center, crab.top, colors[i % colors.length])
        ..vx = rand(-40, 40)
        ..vy = rand(-70, -25)
        ..g = 90
        ..life = m
        ..max = 2.4);
    }
  }

  /// Tap: wake the crab, or drop a token where the finger landed.
  void poke(double x) {
    if (crab.state == Act.sleep || (x - crab.center).abs() < CrabSprite.w / 2 + 1) {
      crab.go(Act.wake);
      return;
    }
    tokens.add(Token(x.floor().clamp(1, max(1, w - 3)), -2, 0));
  }

  void burst(Kind k, double x, double y, int n) {
    if (reduced && k != Kind.z) return;
    for (var i = 0; i < n; i++) {
      final p = Particle(k, x, y, const Color(0xFFFFE6C8));
      switch (k) {
        case Kind.spark:
          p..vx = rand(-30, 30)..vy = rand(-40, -10)..g = 120..life = p.max = 0.35;
        case Kind.smoke:
          p..vx = rand(-4, 4)..vy = rand(-14, -8)..life = p.max = 0.9..color = const Color(0xFF6B5F58);
        case Kind.sweat:
          p..vx = rand(-26, 26)..vy = rand(-34, -16)..g = 130..life = p.max = 0.6..color = const Color(0xFF9CC7CE);
        case Kind.crumb:
          p..vx = rand(-24, 24)..vy = rand(-30, -10)..g = 140..life = p.max = 0.5..color = const Color(0xFFFFC690);
        case Kind.z:
          p..vx = 3..vy = -5..life = p.max = 3..color = const Color(0xFF9CC7CE);
        case Kind.bang:
          p.life = p.max = 0.8;
        case Kind.heart:
          p..vy = -10..life = p.max = 1..color = const Color(0xFFFF9A55);
        case Kind.confetti:
          break;
      }
      parts.add(p);
    }
  }

  // Flame height follows how fast Claude is replying: embers when quiet, up to
  // two thirds of the stage when replies pour in.
  double get _decay {
    final act = min(mood.rpm, 6) / 6;
    final rows = max(3.0, fireH * (0.14 + 0.52 * act));
    return 1 + 2 * maxHeat / rows;
  }

  void _fireStep() {
    final edge = known ? edgeX : 0;
    final base = (fireH - 1) * w;
    for (var x = 0; x < w; x++) {
      // The last few burned columns run cooler, so the fire front slopes.
      var v = x < edge ? maxHeat - (r.nextDouble() < 0.2 ? 1 : 0) - max<int>(0, 4 - (edge - x)) : 0;
      if (flare[x] > 0) {
        v = maxHeat;
        flare[x]--;
      }
      heat[base + x] = v;
    }
    final d = _decay;
    for (var y = 1; y < fireH; y++) {
      for (var x = 0; x < w; x++) {
        final i = y * w + x;
        final p = heat[i];
        if (p == 0) {
          heat[i - w] = 0;
          continue;
        }
        // A light wind toward the cold sand: flames lick at the crab's side.
        final q = r.nextDouble();
        final drift = q < 0.42 ? 1 : q < 0.77 ? 0 : -1;
        final nx = x + drift;
        final dst = (nx < 0 || nx >= w) ? i - w : i - w + drift;
        final dec = (r.nextDouble() * (flare[x] > 0 ? 1.6 : d)).floor();
        heat[dst] = p > dec ? p - dec : 0;
      }
    }
  }

  void update(double dt) {
    if (w == 0) return;
    // The burn front eases toward the real number: ignition on load, retreat on reset.
    final diff = target - burn;
    burn = diff.abs() > 0.001 ? burn + diff * min(1, dt * 2.6) : target;
    if (!reduced) _fireStep();

    final edge = known ? edgeX : 0;
    for (var i = tokens.length - 1; i >= 0; i--) {
      final t = tokens[i];
      if (!t.ground) {
        t.vy += 70 * dt;
        t.y += t.vy * dt;
        if (t.y >= groundY - 2) {
          if (t.x < edge) {
            flare[t.x] = 7;
            if (t.x + 1 < w) flare[t.x + 1] = 7;
            burst(Kind.spark, t.x.toDouble(), groundY - 3, 3);
            t.gone = true;
          } else {
            t.ground = true;
            t.y = groundY - 2;
          }
        }
      } else {
        t.life -= dt;
        if (t.x < edge) t.gone = true; // the fire reached it
      }
      if (t.gone || t.life <= 0) tokens.removeAt(i);
    }
    if (tokens.length > 24) tokens.removeRange(0, tokens.length - 24);

    for (var i = parts.length - 1; i >= 0; i--) {
      final p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        parts.removeAt(i);
        continue;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind == Kind.confetti && p.y > groundY - 1) {
        p.y = groundY - 1;
        p.vx *= 0.6;
        p.vy = 0;
      }
    }
    crab.update(dt);
  }
}
