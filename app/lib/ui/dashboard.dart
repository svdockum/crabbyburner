// The desk screen: top bar, session block, cards. Portrait stacks them;
// landscape puts the block on the left.
import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../crab/stage.dart';
import '../crab/stage_view.dart';
import '../data/feed.dart';
import '../data/format.dart';
import '../main.dart' show keepAwake;
import 'cards.dart';
import 'connect.dart';
import 'session_block.dart';
import 'theme.dart';
import 'widgets.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> with SingleTickerProviderStateMixin {
  late final _enter = AnimationController(vsync: this, duration: const Duration(milliseconds: 900));
  late final AppLifecycleListener _life;
  Timer? _shiftTimer;
  var _shift = 0;
  int? _prevPct, _prevTokens, _prevDay;

  // Nudge the whole sheet two pixels every few minutes so an always-on OLED
  // screen doesn't keep the same edges lit for hours.
  static const _shifts = [Offset.zero, Offset(2, 0), Offset(2, 2), Offset(0, 2), Offset(-2, 2), Offset(-2, 0), Offset(-2, -2), Offset(0, -2), Offset(2, -2)];

  @override
  void initState() {
    super.initState();
    _life = AppLifecycleListener(
      onResume: () {
        keepAwake();
        ref.read(feedProvider.notifier).resume();
      },
      onHide: () => ref.read(feedProvider.notifier).pause(),
    );
    _shiftTimer = Timer.periodic(const Duration(minutes: 3), (_) => setState(() => _shift = (_shift + 1) % _shifts.length));
  }

  @override
  void dispose() {
    _life.dispose();
    _shiftTimer?.cancel();
    _enter.dispose();
    super.dispose();
  }

  /// Turns each poll into what the crab should know: how far the fire goes,
  /// how lively to be, and how many tokens just fell in.
  void _onFeed(Feed? prev, Feed next) {
    final stage = ref.read(stageProvider);
    final u = next.usage;
    if (next.offline) {
      stage.mood = Mood(sleepy: true, pct: stage.mood.pct);
      return;
    }
    if (u == null) return;
    final now = next.now();
    final s = u.limits.freshAt(now) ? u.limits.session : null;
    final pct = s?.percent.round();
    stage.setBurn(pct == null ? null : pct / 100);
    if (_prevPct != null && pct != null && pct < _prevPct! - 10) stage.celebrate();
    if (pct != null) _prevPct = pct;

    final t = u.today;
    if (u.logsReady && t != null) {
      if (_prevTokens != null && _prevDay == now.day && t.tokens > _prevTokens!) {
        final n = (log(t.tokens - _prevTokens!) / ln10 * 1.6).round().clamp(1, 14);
        stage.feed(n);
      }
      _prevTokens = t.tokens;
      _prevDay = now.day;
    }
    final age = u.last == null ? null : now.difference(u.last!.at);
    stage.mood = Mood(sleepy: age == null || age.inMinutes >= 10, rpm: u.rpm, pct: pct ?? 0);
    if (_enter.value == 0 && !_enter.isAnimating) _enter.forward();
  }

  Widget _rise(int i, Widget child, {double dy = 16}) {
    if (MediaQuery.disableAnimationsOf(context)) return child;
    final anim = CurvedAnimation(parent: _enter, curve: Interval(i * .08, min(1, i * .08 + .7), curve: Curves.easeOutExpo));
    return AnimatedBuilder(
      animation: anim,
      builder: (_, c) => Transform.translate(offset: Offset(0, dy * (1 - anim.value)), child: c),
      child: child,
    );
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<Feed>(feedProvider, _onFeed);
    final sc = uiScale(context);
    final landscape = MediaQuery.orientationOf(context) == Orientation.landscape;

    final block = _rise(0, const SessionBlock(), dy: -14);
    final week = _rise(1, const WeekCard());
    final today = _rise(2, const TodayCard());
    final now = _rise(3, const NowCard());

    final body = landscape
        ? Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const _TopBar(),
            SizedBox(height: 16 * sc),
            Expanded(
              child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Expanded(flex: 145, child: block),
                SizedBox(width: 12 * sc),
                Expanded(
                  flex: 200,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Expanded(
                      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Expanded(child: week),
                        SizedBox(width: 12 * sc),
                        Expanded(child: today),
                      ]),
                    ),
                    SizedBox(height: 18 * sc),
                    now,
                  ]),
                ),
              ]),
            ),
          ])
        : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const _TopBar(),
            SizedBox(height: 16 * sc),
            Expanded(child: block),
            SizedBox(height: 20 * sc),
            IntrinsicHeight(
              child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Expanded(child: week),
                SizedBox(width: 12 * sc),
                Expanded(child: today),
              ]),
            ),
            SizedBox(height: 20 * sc),
            now,
          ]);

    return Scaffold(
      body: SafeArea(
        child: TweenAnimationBuilder<Offset>(
          tween: Tween(end: _shifts[_shift]),
          duration: const Duration(seconds: 2),
          builder: (_, o, c) => Transform.translate(offset: o, child: c),
          child: Padding(
            // Under a camera cutout the system already leaves a band; don't add to it.
            padding: EdgeInsets.fromLTRB(
              (landscape ? 14 : 16) * sc,
              MediaQuery.paddingOf(context).top > 0 ? 4 * sc : (landscape ? 8 : 12) * sc,
              (landscape ? 14 : 16) * sc,
              (landscape ? 12 : 16) * sc,
            ),
            child: body,
          ),
        ),
      ),
    );
  }
}

class _TopBar extends ConsumerWidget {
  const _TopBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feed = ref.watch(feedProvider);
    final clock = ref.watch(clockProvider).value ?? DateTime.now();
    final sc = uiScale(context);
    final plan = feed.usage?.limits.plan;
    return SizedBox(
      height: 32 * sc,
      child: Row(children: [
        CrabMark(width: 28 * sc),
        SizedBox(width: 7 * sc),
        Expanded(
          child: Text('CrabbyBurner', maxLines: 1, overflow: TextOverflow.clip, style: K.t(16 * sc, FontWeight.w900, spacing: -.48 * sc)),
        ),
        if (plan != null && MediaQuery.sizeOf(context).width >= 480) ...[TabPill(plan, scale: sc), SizedBox(width: 6 * sc)],
        _StatusPill(polls: feed.polls, offline: feed.offline, connected: feed.usage != null),
        SizedBox(width: 8 * sc),
        Text.rich(numSpan(hm(clock.add(feed.skew)), K.t(16 * sc, FontWeight.w700))),
        SizedBox(width: 8 * sc),
        _RoundButton(
          icon: Icons.desktop_windows_outlined,
          label: 'Change PC',
          onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const ConnectScreen(editing: true))),
        ),
      ]),
    );
  }
}

/// Live / Offline, with a dot that beats each time fresh numbers arrive.
class _StatusPill extends StatefulWidget {
  const _StatusPill({required this.polls, required this.offline, required this.connected});

  final int polls;
  final bool offline, connected;

  @override
  State<_StatusPill> createState() => _StatusPillState();
}

class _StatusPillState extends State<_StatusPill> with SingleTickerProviderStateMixin {
  late final _beat = AnimationController(vsync: this, duration: const Duration(milliseconds: 700), value: 1);

  @override
  void didUpdateWidget(_StatusPill old) {
    super.didUpdateWidget(old);
    if (old.polls != widget.polls && !MediaQuery.disableAnimationsOf(context)) _beat.forward(from: 0);
  }

  @override
  void dispose() {
    _beat.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sc = uiScale(context);
    final live = widget.connected && !widget.offline;
    return Container(
      padding: EdgeInsets.fromLTRB(6 * sc, 1 * sc, 7 * sc, 1 * sc),
      decoration: BoxDecoration(
        color: widget.offline ? K.ice : null,
        border: Border.fromBorderSide(K.border),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        AnimatedBuilder(
          animation: _beat,
          builder: (_, _) {
            final k = Curves.easeOutExpo.transform(_beat.value);
            final ring = _beat.isAnimating ? 9 * k : 0.0;
            return Transform.scale(
              scale: 1.5 - .5 * k,
              child: Container(
                width: 7 * sc,
                height: 7 * sc,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: live ? K.orange : widget.offline ? K.ink : K.quiet,
                  boxShadow: ring > 0 ? [BoxShadow(color: K.orange.withValues(alpha: .7 * (1 - k)), spreadRadius: ring)] : null,
                ),
              ),
            );
          },
        ),
        SizedBox(width: 5 * sc),
        Text(
          (widget.offline ? 'Offline' : live ? 'Live' : 'Connecting').toUpperCase(),
          style: K.t(11 * sc, FontWeight.w700, height: 13 / 11, spacing: .88 * sc),
        ),
      ]),
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final sc = uiScale(context);
    return Semantics(
      button: true,
      label: label,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 30 * sc,
          height: 30 * sc,
          decoration: const BoxDecoration(shape: BoxShape.circle, border: Border.fromBorderSide(K.border)),
          child: Icon(icon, size: 15 * sc, color: K.ink),
        ),
      ),
    );
  }
}
