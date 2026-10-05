// The heart of the screen: the black block with "25% burned.", the burning
// sand with the crab on it, and when the session resets.
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../crab/stage.dart';
import '../crab/stage_view.dart';
import '../data/feed.dart';
import '../data/format.dart';
import 'sessions.dart';
import 'theme.dart';
import 'widgets.dart';

final stageProvider = Provider<Stage>((ref) => Stage());

class SessionBlock extends ConsumerWidget {
  const SessionBlock({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(clockProvider);
    final feed = ref.watch(feedProvider);
    final sc = uiScale(context);
    final now = feed.now();
    final u = feed.usage;
    final lim = u?.limits;
    final s = lim != null && lim.freshAt(now) ? lim.session : null;
    final pct = s?.percent.round();

    var (head, quip) = u == null
        ? ('Connecting.', 'Asking your PC for the numbers.')
        : limitErrors[lim?.error ?? 'pending'] ?? limitErrors['pending']!;
    if (pct != null) quip = quipFor(pct);
    final note = u == null ? null : resumeNote(u.resume);
    quip = note ?? quip;
    if (feed.offline) quip = feed.lastOk == null ? 'Retrying.' : 'Numbers from ${hm(feed.lastOk!)}. Retrying.';

    final resetsAt = s?.resetsAt;
    final quiet = K.t(15 * sc, FontWeight.w500, color: K.onInkQuiet, height: 20 / 15);
    final reset = resetsAt == null
        ? (u != null && lim?.error != null ? 'Limits unavailable' : 'Resets in –')
        : '${pct != null && pct >= 100 ? 'Back in' : 'Resets in'} ${span(resetsAt.difference(now))}';

    return LayoutBuilder(builder: (context, box) {
      // A tall phone gets the number on a line of its own, big enough to read
      // from across the desk; the stage keeps about the same pixel size.
      final tall = box.maxHeight > box.maxWidth * 1.1;
      return Kaart(
        dark: true,
        tab: TabPill('Session · 5 hours', kind: TabKind.hot, scale: sc),
        padding: EdgeInsets.fromLTRB(18 * sc, 22 * sc, 18 * sc, 14 * sc),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Opacity(
              opacity: feed.offline ? .45 : 1,
              child: _Headline(pct: pct, text: head, maxSize: tall ? box.maxHeight * .26 : 64 * sc, stacked: tall),
            ),
            SizedBox(height: 6 * sc),
            // When it's about cut-off sessions, the line opens the list of them.
            note == null || feed.offline
                ? Text(quip, style: quiet)
                : GestureDetector(onTap: () => openSessions(context), child: Text(quip, style: quiet)),
            SizedBox(height: 8 * sc),
            Expanded(
              child: Semantics(
                label: pct == null ? 'Session usage unknown' : 'Session $pct% burned',
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: StageView(stage: ref.watch(stageProvider)),
                ),
              ),
            ),
            SizedBox(height: 10 * sc),
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Expanded(child: Text.rich(numSpan(reset, K.t(15 * sc, FontWeight.w700, color: K.onInk)))),
                if (resetsAt != null) Text.rich(numSpan('at ${hm(resetsAt)}', quiet)),
              ],
            ),
          ],
        ),
      );
    });
  }
}

/// "25% burned." sized so its widest form, "100% burned.", still fits the
/// block; stacked, "100%" fits on its own line and "burned." sits under it.
/// The number counts up to its new value.
class _Headline extends StatelessWidget {
  const _Headline({required this.pct, required this.text, required this.maxSize, this.stacked = false});

  final int? pct;
  final String text;
  final double maxSize;
  final bool stacked;

  static TextStyle _style(double size, [Color color = K.onInk]) =>
      K.t(size, FontWeight.w900, color: color, height: .95, spacing: -.04 * size);

  static double _fit(String probe, double width, double cap) {
    final tp = TextPainter(
      text: TextSpan(text: probe, style: _style(100).copyWith(fontFeatures: K.tnum)),
      textDirection: TextDirection.ltr,
      maxLines: 1,
    )..layout();
    final size = min(cap, width / tp.width * 100 * .98);
    tp.dispose();
    return size;
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, box) {
      if (pct == null) return Text(text, style: _style(min(maxSize, 64) * .62));
      final size = _fit(stacked ? '100%' : '100% burned.', box.maxWidth, maxSize);
      final small = stacked ? size * .5 : size;
      final digits = _style(size, K.orange).copyWith(fontFeatures: K.tnum);
      return TweenAnimationBuilder<double>(
        tween: Tween(end: pct!.toDouble()),
        duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 1100),
        curve: Curves.easeOutExpo,
        builder: (_, v, _) => Text.rich(
          TextSpan(children: [
            TextSpan(text: '${v.round()}', style: digits),
            TextSpan(text: '%', style: _style(size, K.orange)),
            TextSpan(text: stacked ? '\nburned' : ' burned', style: _style(small)),
            TextSpan(text: '.', style: _style(small, K.orange)),
          ]),
          maxLines: stacked ? 2 : 1,
          softWrap: false,
        ),
      );
    });
  }
}
