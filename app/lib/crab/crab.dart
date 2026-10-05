// The crab's behaviour: a small state machine that picks random things to do,
// weighted by how busy Claude is and how burned the session is.
import 'dart:math';

import 'sprite.dart';
import 'stage.dart';

enum Act { idle, walk, eat, panic, snap, dance, look, wave, wake, sleep }

class Crab {
  Crab(this.s);

  final Stage s;
  final _r = Random();

  double x = 4, jump = 0, vy = 0;
  Act state = Act.sleep;
  double t = 0, dur = 1e9, tick = 0, target = 0, speed = 12, legDist = 0;
  Legs legs = Legs.a;
  Eyes eyes = Eyes.sleep, look = Eyes.sleep;
  double blinkIn = 2, blinkLeft = 0, hotT = 0, flash = 0;
  bool lShut = false, rShut = false;
  int lLift = 0, rLift = 0;
  Token? food;

  double rand(double a, double b) => a + _r.nextDouble() * (b - a);
  double get center => x + CrabSprite.w / 2;
  double get top => s.groundY - CrabSprite.h - jump.roundToDouble();

  void hop(double v) {
    if (jump <= 0.01) vy = v;
  }

  void go(Act next, {Token? meal, double? length}) {
    final m = s.mood;
    final maxX = max(0.0, s.w - CrabSprite.w.toDouble());
    state = next;
    t = 0;
    tick = 0;
    legDist = 0;
    lLift = rLift = 0;
    lShut = rShut = false;
    look = Eyes.open;
    final pace = m.pct >= 85 ? 26.0 : m.rpm >= 2 ? 20.0 : 12.0;
    switch (next) {
      case Act.walk:
        speed = pace;
        target = coolSpot(maxX);
        dur = 12;
      case Act.eat:
        food = meal!..claimed = true;
        speed = pace + 8;
        target = (meal.x - CrabSprite.w / 2 + 1).clamp(0.0, maxX);
        dur = 12;
      case Act.panic:
        speed = 44;
        target = rand(0, maxX);
        dur = rand(2.5, 3.5);
      case Act.snap:
        dur = rand(0.8, 1.4);
      case Act.dance:
        dur = length ?? 2.8;
      case Act.look:
        dur = 2;
      case Act.wave:
        dur = 1.6;
      case Act.wake:
        dur = 0.9;
        hop(42);
        s.burst(Kind.bang, center, top - 7, 1);
      case Act.sleep:
        dur = 1e9;
      case Act.idle:
        dur = rand(1.2, 3.2);
    }
  }

  // Given the choice, crabs walk where the sand is cold.
  double coolSpot(double maxX) {
    final edge = s.edgeX.toDouble();
    if (edge > 0 && edge < maxX - 4 && _r.nextDouble() < 0.75) return rand(edge, maxX);
    return rand(0, maxX);
  }

  void next() {
    final m = s.mood;
    if (m.sleepy) return go(Act.sleep);
    if (s.reduced) return go(_r.nextDouble() < 0.6 ? Act.idle : Act.look);
    final meal = s.nearestToken(center);
    if (meal != null && _r.nextDouble() < 0.9) return go(Act.eat, meal: meal);
    final table = m.pct >= 85
        ? const [(Act.panic, 3), (Act.snap, 3), (Act.walk, 3), (Act.idle, 1)]
        : m.rpm >= 2
            ? const [(Act.walk, 5), (Act.snap, 2), (Act.idle, 2), (Act.dance, 1), (Act.look, 1)]
            : const [(Act.idle, 4), (Act.walk, 4), (Act.look, 2), (Act.snap, 1), (Act.dance, 1), (Act.wave, 1)];
    final total = table.fold<int>(0, (a, e) => a + e.$2);
    var roll = _r.nextDouble() * total;
    for (final (act, weight) in table) {
      roll -= weight;
      if (roll <= 0) return go(act);
    }
    go(table.first.$1);
  }

  bool walkTo(double dt) {
    final d = target - x;
    if (d.abs() < 0.6) return true;
    final step = min(d.abs(), speed * dt) * d.sign;
    x += step;
    legDist += step.abs();
    if (legDist >= 1.6) {
      legDist = 0;
      legs = legs == Legs.a ? Legs.b : Legs.a;
    }
    look = d > 0 ? Eyes.right : Eyes.left;
    final bob = legs == Legs.a ? 0 : 1;
    lLift = bob;
    rLift = 1 - bob;
    return false;
  }

  void update(double dt) {
    final m = s.mood;
    t += dt;
    tick += dt;

    if (jump > 0 || vy > 0) {
      vy -= 150 * dt;
      jump += vy * dt;
      if (jump <= 0) jump = vy = 0;
    }
    if (m.sleepy && state != Act.sleep && state != Act.wake && state != Act.eat) go(Act.sleep);
    if (!m.sleepy && state == Act.sleep) go(Act.wake);

    var done = t >= dur;
    switch (state) {
      case Act.walk:
      case Act.panic:
        if (walkTo(dt)) {
          if (state == Act.panic && !done) {
            target = rand(0, max(0, s.w - CrabSprite.w.toDouble()));
          } else {
            done = true;
          }
        }
        if (state == Act.panic) {
          look = Eyes.shock;
          lLift = rLift = 1;
          if (tick > 0.22) {
            tick = 0;
            s.burst(Kind.sweat, center + rand(-8, 8), top + 3, 1);
          }
        }
      case Act.eat:
        final meal = food;
        if (meal == null || meal.gone) {
          done = true;
          break;
        }
        if ((target - x).abs() >= 0.6) {
          walkTo(dt);
          tick = 0;
          break;
        }
        legs = Legs.a;
        look = Eyes.open;
        final shut = (tick / 0.13).floor().isOdd;
        lShut = rShut = shut;
        lLift = rLift = -1;
        if (tick > 0.55) {
          meal.gone = true;
          s.burst(Kind.crumb, center, s.groundY - 3, 5);
          s.burst(Kind.heart, center, top - 6, 1);
          hop(30);
          go(Act.dance, length: 0.9);
          return;
        }
      case Act.snap:
        final sh = (tick / 0.12).floor().isOdd;
        if (sh && !lShut) s.burst(Kind.spark, x + (_r.nextBool() ? 2 : CrabSprite.w - 3), top + 1, 2);
        lShut = sh;
        rShut = !sh;
        lLift = rLift = 1;
        look = m.pct >= 85 ? Eyes.angry : Eyes.open;
      case Act.dance:
        if (tick > 0.36) {
          tick = 0;
          hop(34);
          legs = legs == Legs.a ? Legs.b : Legs.a;
        }
        final up = legs == Legs.a;
        lLift = up ? 1 : -1;
        rLift = up ? -1 : 1;
        look = Eyes.happy;
      case Act.look:
        look = t < 0.7 ? Eyes.left : t < 1.4 ? Eyes.right : Eyes.open;
      case Act.wave:
        final beat = (t / 0.2).floor();
        if (center < s.w / 2) {
          rLift = beat.isOdd ? 1 : 0;
          rShut = beat.isEven;
        } else {
          lLift = beat.isOdd ? 1 : 0;
          lShut = beat.isEven;
        }
        look = Eyes.happy;
      case Act.sleep:
        legs = Legs.none;
        look = Eyes.sleep;
        lShut = rShut = true;
        lLift = rLift = -1;
        if (tick > 1.5) {
          tick = 0;
          s.burst(Kind.z, x + CrabSprite.w - 4, top + 2, 1);
        }
      case Act.wake:
        legs = Legs.a;
        look = Eyes.shock;
        lLift = rLift = 1;
      case Act.idle:
        legs = Legs.a;
        if (tick > 1.1) {
          tick = 0;
          rShut = _r.nextDouble() < 0.3;
        }
        look = m.pct >= 85 ? Eyes.angry : Eyes.open;
    }
    if (state != Act.sleep && legs == Legs.none) legs = Legs.a;

    // Hot feet: standing in the burned part makes the crab hop.
    final inFire = s.known && center < s.edgeX - 2 && state != Act.sleep;
    if (inFire) {
      hotT += dt;
      if (hotT > 0.5) {
        hotT = 0;
        hop(22);
        flash = 0.25;
        s.burst(Kind.smoke, center + rand(-6, 6), s.groundY - 1, 2);
      }
    } else {
      hotT = 0;
    }

    // Blinking, unless the eyes are busy saying something else.
    blinkIn -= dt;
    if (blinkIn <= 0) {
      blinkLeft = 0.13;
      blinkIn = rand(2, 5.5);
    }
    blinkLeft -= dt;
    flash -= dt;
    eyes = flash > 0
        ? Eyes.shock
        : blinkLeft > 0 && look != Eyes.sleep && look != Eyes.happy
            ? Eyes.blink
            : look;

    if (done && state != Act.sleep) next();
  }

  List<Px> get pixels => CrabSprite.pixels(
        legs: legs,
        eyes: eyes,
        lShut: lShut,
        lLift: lLift,
        rShut: rShut,
        rLift: rLift,
      );
}
