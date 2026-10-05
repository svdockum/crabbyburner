// The crab: a 22 x 13 pixel Clawd-shaped body with pincers. Same sprite as
// public/sprite.js on the web page.
import 'dart:ui';

enum Legs { a, b, none }

enum Eyes { open, left, right, blink, happy, shock, angry, sleep }

class Px {
  final int x, y;
  final Color color;
  const Px(this.x, this.y, this.color);
}

class CrabSprite {
  static const int w = 22, h = 13;

  static const body = Color(0xFFFF6A13);
  static const light = Color(0xFFFF9A55);
  static const shade = Color(0xFFC2410C);
  static const eye = Color(0xFF141110);

  static const _rows = [
    '.....hhhhhhhhhhhh.....',
    '.....oooooooooooo.....',
    '.....oooooooooooo.....',
    '.....oooooooooooo.....',
    '..oooooooooooooooooo..',
    '..oooooooooooooooooo..',
    '.....oooooooooooo.....',
    '.....ssssssssssss.....',
  ];
  static const _open = ['o.o', 'o.o', 'ooo'];
  static const _shut = ['.o.', 'ooo', 'ooo'];
  static const _legs = {Legs.a: [6, 8, 13, 15], Legs.b: [5, 7, 14, 16]};
  static const _blink = [[6, 6], [7, 6], [14, 6], [15, 6]];
  static const _eyes = {
    Eyes.open: [[7, 5], [7, 6], [14, 5], [14, 6]],
    Eyes.left: [[6, 5], [6, 6], [13, 5], [13, 6]],
    Eyes.right: [[8, 5], [8, 6], [15, 5], [15, 6]],
    Eyes.blink: _blink,
    Eyes.sleep: _blink,
    Eyes.happy: [[6, 6], [7, 5], [8, 6], [13, 6], [14, 5], [15, 6]],
    Eyes.shock: [[7, 5], [8, 5], [7, 6], [8, 6], [13, 5], [14, 5], [13, 6], [14, 6]],
    Eyes.angry: [[6, 3], [7, 4], [7, 5], [7, 6], [15, 3], [14, 4], [14, 5], [14, 6]],
  };

  static final _cache = <int, List<Px>>{};

  static Color _color(String c) => c == 'h' ? light : c == 's' ? shade : body;

  static void _claw(List<Px> out, int x0, bool shut, int lift, int drop) {
    final top = 1 - lift;
    final shape = shut ? _shut : _open;
    for (var r = 0; r < 3; r++) {
      for (var k = 0; k < 3; k++) {
        if (shape[r][k] == 'o') out.add(Px(x0 + k, top + r + drop, r == 0 ? light : body));
      }
    }
    for (var y = top + 3; y <= 6; y++) {
      out.add(Px(x0 + 1, y + drop, body));
    }
  }

  /// Sleeping crabs (legs none) sit two pixels lower, flat on the sand.
  static List<Px> pixels({
    Legs legs = Legs.a,
    Eyes eyes = Eyes.open,
    bool lShut = false,
    int lLift = 0,
    bool rShut = false,
    int rLift = 0,
  }) {
    final key = legs.index |
        eyes.index << 2 |
        (lShut ? 1 : 0) << 6 |
        (lLift + 2) << 7 |
        (rShut ? 1 : 0) << 10 |
        (rLift + 2) << 11;
    final hit = _cache[key];
    if (hit != null) return hit;

    final out = <Px>[];
    final drop = legs == Legs.none ? 2 : 0;
    for (var i = 0; i < _rows.length; i++) {
      for (var x = 0; x < w; x++) {
        final c = _rows[i][x];
        if (c != '.') out.add(Px(x, 3 + i + drop, _color(c)));
      }
    }
    _claw(out, 1, lShut, lLift, drop);
    _claw(out, 18, rShut, rLift, drop);
    if (legs != Legs.none) {
      for (final x in _legs[legs]!) {
        out.add(Px(x, 11, shade));
        out.add(Px(x, 12, shade));
      }
    }
    for (final e in _eyes[eyes]!) {
      out.add(Px(e[0], e[1] + drop, eye));
    }
    return _cache[key] = out;
  }
}
