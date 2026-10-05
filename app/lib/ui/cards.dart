// The cards under the block: this week, today, and what Claude is doing now.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/feed.dart';
import '../data/format.dart';
import 'sessions.dart';
import 'theme.dart';
import 'widgets.dart';

TextStyle _big(double sc) => K.t(32 * sc, FontWeight.w900, height: 1, spacing: -.96 * sc);
TextStyle _unit(double sc) => K.t(13 * sc, FontWeight.w500, color: K.quiet);
TextStyle _small(double sc) => K.t(13 * sc, FontWeight.w400, color: K.quiet, height: 17 / 13);

/// A big number with its unit, then a meter that takes the card's spare
/// height (within limits), then the footnotes at the bottom.
class _MeterCard extends StatelessWidget {
  const _MeterCard({required this.tab, required this.number, required this.unit, required this.meter, required this.minH, required this.maxH, required this.foot, required this.dim});

  final String tab, unit;
  final Widget number, meter;
  final double minH, maxH;
  final List<Widget> foot;
  final bool dim;

  @override
  Widget build(BuildContext context) {
    final sc = uiScale(context);
    return Kaart(
      tab: TabPill(tab, scale: sc),
      padding: EdgeInsets.fromLTRB(14 * sc, 18 * sc, 14 * sc, 12 * sc),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Opacity(
            opacity: dim ? .45 : 1,
            // A long number shrinks a little rather than spill out of the card.
            child: FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [number, Text(unit, style: _unit(sc), maxLines: 1)],
              ),
            ),
          ),
          SizedBox(height: 10 * sc),
          Expanded(
            child: Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: minH * sc, maxHeight: maxH * sc),
                child: SizedBox.expand(child: Opacity(opacity: dim ? .45 : 1, child: meter)),
              ),
            ),
          ),
          for (final f in foot) Padding(padding: EdgeInsets.only(top: 8 * sc), child: f),
        ],
      ),
    );
  }
}

class WeekCard extends ConsumerWidget {
  const WeekCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(clockProvider);
    final feed = ref.watch(feedProvider);
    final sc = uiScale(context);
    final now = feed.now();
    final lim = feed.usage?.limits;
    final w = lim != null && lim.freshAt(now) ? lim.weekly : null;
    final wp = w?.percent.round();
    final scoped = w == null ? '' : lim!.scoped.map((s) => '${s.label} ${s.percent.round()}%').join(' · ');
    return _MeterCard(
      tab: 'This week',
      number: wp == null
          ? Text('–', style: _big(sc))
          : CountUp(wp.toDouble(), format: (v) => '${v.round()}%', style: _big(sc)),
      unit: ' used',
      meter: Bits(wp?.toDouble()),
      minH: 12,
      maxH: 40,
      dim: feed.offline,
      foot: [
        if (w?.resetsAt != null) Text('Resets ${when(w!.resetsAt!, now)}', style: _small(sc)),
        if (scoped.isNotEmpty) Text(scoped, style: _small(sc)),
      ],
    );
  }
}

class TodayCard extends ConsumerWidget {
  const TodayCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feed = ref.watch(feedProvider);
    final sc = uiScale(context);
    final u = feed.usage;
    final t = u != null && u.logsReady ? u.today : null;
    final bold = K.t(13 * sc, FontWeight.w700);
    return _MeterCard(
      tab: 'Today',
      number: t == null
          ? Text('–', style: _big(sc))
          : CountUp(t.tokens.toDouble(), format: compact, style: _big(sc)),
      unit: ' tokens',
      meter: Hours(t?.hourly ?? const [], feed.now().hour),
      minH: 38,
      maxH: 84,
      dim: feed.offline,
      foot: [
        t == null
            ? Text(u == null ? '' : 'Reading your logs…', style: _small(sc))
            : Text.rich(
                TextSpan(children: [
                  TextSpan(text: grouped(t.replies), style: bold),
                  const TextSpan(text: ' replies · '),
                  TextSpan(text: compact(t.output), style: bold),
                  const TextSpan(text: ' output'),
                ]),
                style: _small(sc),
              ),
      ],
    );
  }
}

class NowCard extends ConsumerWidget {
  const NowCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(clockProvider);
    final feed = ref.watch(feedProvider);
    final sc = uiScale(context);
    final wide = MediaQuery.sizeOf(context).width >= 420;
    final last = feed.usage?.last;

    final (String label, TabKind kind, String head, String meta) = switch (feed) {
      _ when feed.offline => ('No signal', TabKind.ice, 'Can’t reach your PC.', 'Is it running?'),
      _ when last == null => ('Now', TabKind.ink, feed.usage == null ? 'Connecting…' : 'No replies this week yet.', ''),
      _ => _now(feed, wide),
    };

    // Tapping opens every session, with auto-continue; the dot says some won't
    // continue by themselves.
    final attention = (feed.usage?.resume.attention ?? 0) > 0;
    return Semantics(
      button: true,
      label: 'Sessions and auto-continue',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => openSessions(context),
        child: Kaart(
          tab: TabPill(label, kind: kind, scale: sc),
          padding: EdgeInsets.fromLTRB(14 * sc, 15 * sc, 10 * sc, 11 * sc),
          child: Row(children: [
            Expanded(
              child: Opacity(
                opacity: feed.offline ? .45 : 1,
                child: Text.rich(
                  TextSpan(children: [
                    TextSpan(text: head, style: K.t(15 * sc, FontWeight.w700)),
                    TextSpan(text: meta.isEmpty ? '' : ' $meta', style: K.t(15 * sc, FontWeight.w400, color: K.quiet)),
                  ]),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
            if (attention) ...[
              SizedBox(width: 6 * sc),
              Container(width: 8 * sc, height: 8 * sc, decoration: const BoxDecoration(color: K.orange, shape: BoxShape.circle)),
            ],
            Icon(Icons.chevron_right, size: 20 * sc, color: K.ink),
          ]),
        ),
      ),
    );
  }

  (String, TabKind, String, String) _now(Feed feed, bool wide) {
    final u = feed.usage!;
    final last = u.last!;
    final age = feed.now().difference(last.at);
    final others = u.active.where((p) => p != last.project).length;
    final (label, kind) = age.inSeconds < 90
        ? ('Working', TabKind.hot)
        : age.inMinutes < 10
            ? ('Idle', TabKind.ink)
            : ('Asleep', TabKind.ice);
    final more = wide && others > 0 ? ' · +$others more' : '';
    return (label, kind, last.project ?? 'Claude Code', '· ${modelName(last.model)} · ${ago(age)}$more');
  }
}
