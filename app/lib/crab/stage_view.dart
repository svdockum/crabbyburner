// Paints the stage as crisp pixels and ticks it at 20 fps (4 fps with reduced
// motion). Pixels are batched into one path per colour, so a frame is a dozen
// draw calls however busy the fire gets.
import 'dart:math';

import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

import 'sprite.dart';
import 'stage.dart';

class StageView extends StatefulWidget {
  const StageView({super.key, required this.stage});

  final Stage stage;

  @override
  State<StageView> createState() => _StageViewState();
}

class _StageViewState extends State<StageView> with SingleTickerProviderStateMixin {
  late final Ticker _ticker = createTicker(_onTick);
  final _repaint = ValueNotifier<int>(0);
  Duration _last = Duration.zero;
  double _acc = 0;
  double _px = 4;

  @override
  void initState() {
    super.initState();
    _ticker.start();
  }

  @override
  void dispose() {
    _ticker.dispose();
    _repaint.dispose();
    super.dispose();
  }

  void _onTick(Duration now) {
    final stage = widget.stage;
    final step = stage.reduced ? 0.25 : 0.05;
    _acc += min((now - _last).inMicroseconds / 1e6, 0.5);
    _last = now;
    if (_acc < step) return;
    final dt = min(_acc, 0.2);
    _acc = 0;
    stage.update(dt);
    _repaint.value++;
  }

  @override
  Widget build(BuildContext context) {
    final stage = widget.stage;
    stage.reduced = MediaQuery.disableAnimationsOf(context);
    final dpr = MediaQuery.devicePixelRatioOf(context);
    return LayoutBuilder(builder: (context, box) {
      // Whole device pixels per stage pixel keeps every edge crisp.
      final logical = min(box.maxWidth / 64, box.maxHeight / 36).roundToDouble().clamp(3.0, 8.0);
      _px = max(1, (logical * dpr).round()) / dpr;
      stage.resize((box.maxWidth / _px).floor(), (box.maxHeight / _px).floor());
      return GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (d) {
          final offsetX = (box.maxWidth - stage.w * _px) / 2;
          stage.poke((d.localPosition.dx - offsetX) / _px);
        },
        child: CustomPaint(
          size: Size(box.maxWidth, box.maxHeight),
          painter: _StagePainter(stage, _px, _repaint),
        ),
      );
    });
  }
}

class _StagePainter extends CustomPainter {
  _StagePainter(this.stage, this.px, Listenable repaint) : super(repaint: repaint);

  final Stage stage;
  final double px;

  static const _sand = Color(0xFF5A4434), _sandDeep = Color(0xFF33261D), _speck = Color(0xFF7A5F4C);
  static const _tick = Color(0xFFC9B8AC), _ember = Color(0xFFA8320B), _hot = Color(0xFFFF7A2B);
  static const _hot2 = Color(0xFFF86415), _edge = Color(0xFFFFE6C8), _token = Color(0xFFFFC690);

  @override
  void paint(Canvas canvas, Size size) {
    final s = stage;
    if (s.w == 0) return;
    // Fire first, then everything else. Within a layer, colours draw in the
    // order they first appear, which puts the crab's eyes over its body.
    final fire = <Color, Path>{}, top = <Color, Path>{};
    var layer = fire;
    void dot(Color c, double x, double y, [double w = 1, double h = 1]) {
      (layer[c] ??= Path()).addRect(Rect.fromLTWH(x, y, w, h));
    }

    // Fire: merge runs of equal heat on each row into one rectangle.
    if (s.known && !s.reduced) {
      for (var y = 0; y < s.fireH; y++) {
        var x = 0;
        while (x < s.w) {
          final v = s.heat[y * s.w + x];
          var end = x + 1;
          while (end < s.w && s.heat[y * s.w + end] == v) {
            end++;
          }
          if (v > 0) dot(fireColors[v], x.toDouble(), y.toDouble(), (end - x).toDouble());
          x = end;
        }
      }
    }

    // The floor is the meter: burned sand on the left, cold sand on the right.
    layer = top;
    final edge = s.known ? s.edgeX : 0;
    final gy = s.groundY.toDouble();
    for (var x = 0; x < s.w; x++) {
      final burned = x < edge;
      dot(burned ? (x % 3 == 0 ? _hot : _hot2) : (x % 7 == 3 ? _speck : _sand), x.toDouble(), gy);
      dot(burned ? _ember : _sandDeep, x.toDouble(), gy + 1);
    }
    for (var q = 1; q < 4; q++) {
      dot(_tick, (s.w * q / 4).roundToDouble(), gy + 1);
    }
    if (s.known && edge > 0 && edge < s.w) {
      dot(s.r.nextDouble() < 0.7 ? _edge : _hot, edge - 1.0, gy);
    }

    final glint = DateTime.now().millisecondsSinceEpoch / 400;
    for (final t in s.tokens) {
      final ty = t.y.roundToDouble();
      dot(_token, t.x.toDouble(), ty, 2, 2);
      dot(t.ground && (glint + t.x) % 3 < 0.4 ? const Color(0xFFFFFFFF) : _edge, t.x.toDouble(), ty);
    }

    final cx = s.crab.x.roundToDouble(), cy = s.crab.top;
    for (final p in s.crab.pixels) {
      dot(p.color, cx + p.x, cy + p.y);
    }

    for (final p in s.parts) {
      final fade = p.kind == Kind.smoke || p.kind == Kind.z;
      final c = fade ? p.color.withValues(alpha: max(0, p.life / p.max)) : p.color;
      final g = glyphs[p.kind];
      final px0 = p.x.roundToDouble(), py0 = p.y.roundToDouble();
      if (g == null) {
        dot(c, px0, py0);
        continue;
      }
      for (var row = 0; row < g.length; row++) {
        final half = g[row].length >> 1;
        for (var k = 0; k < g[row].length; k++) {
          if (g[row][k] == 'o') dot(c, px0 - half + k, py0 + row);
        }
      }
    }

    canvas.save();
    // Centre horizontally, sit on the bottom edge.
    canvas.translate(((size.width - s.w * px) / 2).roundToDouble(), size.height - s.h * px);
    canvas.scale(px);
    final paint = Paint()..isAntiAlias = false;
    for (final paths in [fire, top]) {
      paths.forEach((color, path) {
        paint.color = color;
        canvas.drawPath(path, paint);
      });
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_StagePainter old) => old.px != px || old.stage != stage;
}

/// The crab as a still image, for the header mark.
class CrabMark extends StatelessWidget {
  const CrabMark({super.key, this.width = 28});

  final double width;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: width,
        height: width * CrabSprite.h / CrabSprite.w,
        child: CustomPaint(painter: _MarkPainter()),
      );
}

class _MarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / CrabSprite.w);
    final paint = Paint()..isAntiAlias = false;
    for (final p in CrabSprite.pixels()) {
      paint.color = p.color;
      canvas.drawRect(Rect.fromLTWH(p.x.toDouble(), p.y.toDouble(), 1, 1), paint);
    }
  }

  @override
  bool shouldRepaint(_MarkPainter old) => false;
}
