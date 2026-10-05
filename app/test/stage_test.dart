import 'dart:math';

import 'package:crabbyburner/crab/crab.dart';
import 'package:crabbyburner/crab/sprite.dart';
import 'package:crabbyburner/crab/stage.dart';
import 'package:flutter_test/flutter_test.dart';

void run(Stage s, double seconds) {
  for (var t = 0.0; t < seconds; t += 0.05) {
    s.update(0.05);
  }
}

void main() {
  test('the burn front eases to the session number and the fire stays behind it', () {
    final s = Stage(random: Random(1))..resize(60, 40);
    s.mood = const Mood(sleepy: false, rpm: 6, pct: 25);
    s.setBurn(.25);
    run(s, 4);
    expect(s.burn, closeTo(.25, .005));
    expect(s.edgeX, 15);
    // The bottom row of the fire burns only on the burned sand.
    final base = (s.fireH - 1) * s.w;
    expect(s.heat[base + 2], greaterThan(0));
    expect(s.heat[base + 40], 0);
  });

  test('tokens flare in the fire and land on the cold sand', () {
    final s = Stage(random: Random(2))..resize(60, 40);
    s.mood = const Mood(sleepy: false);
    s.setBurn(.5);
    run(s, 3);
    s.tokens
      ..add(Token(5, 0, 0))
      ..add(Token(50, 0, 0));
    run(s, 2);
    expect(s.tokens.where((t) => t.x == 5), isEmpty, reason: 'burned up');
    expect(s.tokens.where((t) => t.x == 50 && t.ground), isNotEmpty, reason: 'landed');
  });

  test('a sleepy crab sleeps; activity wakes it; it never leaves the stage', () {
    final s = Stage(random: Random(3))..resize(60, 40);
    run(s, 1);
    expect(s.crab.state, Act.sleep);
    s.mood = const Mood(sleepy: false, rpm: 4, pct: 90);
    run(s, 30);
    expect(s.crab.state, isNot(Act.sleep));
    expect(s.crab.x, inInclusiveRange(0, 60 - CrabSprite.w));
  });

  test('celebrating throws confetti and dances', () {
    final s = Stage(random: Random(4))..resize(60, 40);
    s.mood = const Mood(sleepy: false);
    s.celebrate();
    expect(s.parts.where((p) => p.kind == Kind.confetti), hasLength(46));
    expect(s.crab.state, Act.dance);
  });

  test('every sprite pose stays inside its 22 x 13 box', () {
    for (final legs in Legs.values) {
      for (final eyes in Eyes.values) {
        for (final lift in [-1, 0, 1]) {
          for (final p in CrabSprite.pixels(legs: legs, eyes: eyes, lLift: lift, rLift: lift, lShut: true)) {
            expect(p.x, inInclusiveRange(0, CrabSprite.w - 1));
            expect(p.y, inInclusiveRange(0, CrabSprite.h - 1));
          }
        }
      }
    }
  });
}
