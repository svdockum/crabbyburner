// The few pieces the screen is built from: the tab, the card, the meters.
import 'dart:math';

import 'package:flutter/material.dart';

import 'theme.dart';

enum TabKind { ink, hot, ice }

class TabPill extends StatelessWidget {
  const TabPill(this.text, {super.key, this.kind = TabKind.ink, this.scale = 1});

  final String text;
  final TabKind kind;
  final double scale;

  @override
  Widget build(BuildContext context) {
    final onInk = kind == TabKind.ink;
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10 * scale, vertical: 1 * scale),
      decoration: BoxDecoration(
        gradient: kind == TabKind.ink ? K.gradInk : kind == TabKind.hot ? K.gradOrange : null,
        color: kind == TabKind.ice ? K.ice : null,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text.toUpperCase(),
        maxLines: 1,
        style: K.t(11 * scale, FontWeight.w700, color: onInk ? K.onInk : K.ink, height: 16 / 11, spacing: .88 * scale),
      ),
    );
  }
}

/// A card: 2px ink border, soft corners, one shadow, a tab half over the top edge.
class Kaart extends StatelessWidget {
  const Kaart({
    super.key,
    required this.tab,
    required this.child,
    this.dark = false,
    this.padding = const EdgeInsets.fromLTRB(14, 18, 14, 12),
  });

  final Widget tab;
  final Widget child;
  final bool dark;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: dark ? null : K.ground,
              gradient: dark ? K.gradInk : null,
              border: Border.fromBorderSide(K.border),
              borderRadius: BorderRadius.circular(dark ? 20 : 12),
              boxShadow: K.shadow,
            ),
          ),
        ),
        Padding(padding: padding, child: child),
        Positioned(top: -10, left: 14, child: tab),
      ],
    );
  }
}

/// A number that counts to its new value instead of jumping.
class CountUp extends StatelessWidget {
  const CountUp(this.value, {super.key, required this.format, required this.style, this.ms = 900});

  final double value;
  final String Function(double) format;
  final TextStyle style;
  final int ms;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context)) return Text.rich(numSpan(format(value), style), maxLines: 1);
    return TweenAnimationBuilder<double>(
      tween: Tween(end: value),
      duration: Duration(milliseconds: ms),
      curve: Curves.easeOutExpo,
      builder: (_, v, _) => Text.rich(numSpan(format(v), style), maxLines: 1),
    );
  }
}

/// Twenty bits, five percent each; the last lit one flickers like an ember.
class Bits extends StatefulWidget {
  const Bits(this.percent, {super.key});

  final double? percent;

  @override
  State<Bits> createState() => _BitsState();
}

class _BitsState extends State<Bits> with SingleTickerProviderStateMixin {
  late final _flicker = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..repeat();

  @override
  void dispose() {
    _flicker.dispose();
    super.dispose();
  }

  double _opacity(double t) => t < .35 ? 1 : t < .55 ? .55 : t < .8 ? 1 : .75;

  @override
  Widget build(BuildContext context) {
    final p = widget.percent;
    final on = p == null ? 0 : min(20, (p / 5).ceil());
    final hot = p != null && p >= 80;
    final still = MediaQuery.disableAnimationsOf(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < 20; i++) ...[
          if (i > 0) const SizedBox(width: 2),
          Expanded(
            child: i == on - 1 && p! < 100 && !still
                ? FadeTransition(
                    opacity: _flicker.drive(_FlickerTween(_opacity)),
                    child: _bit(hot ? K.hot : K.orange),
                  )
                : _bit(i < on ? (hot ? K.hot : K.orange) : K.empty),
          ),
        ],
      ],
    );
  }

  Widget _bit(Color c) => AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(1)),
      );
}

/// Holds each opacity for a beat instead of fading, like the CSS steps().
class _FlickerTween extends Animatable<double> {
  _FlickerTween(this.f);
  final double Function(double) f;
  @override
  double transform(double t) => f(t);
}

/// Tokens per hour today, in six steps, the current hour in orange.
class Hours extends StatelessWidget {
  const Hours(this.hourly, this.current, {super.key});

  final List<int> hourly;
  final int current;

  @override
  Widget build(BuildContext context) {
    final top = hourly.isEmpty ? 0 : hourly.reduce(max);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < 24; i++) ...[
          if (i > 0) const SizedBox(width: 2),
          Expanded(
            child: Builder(builder: (_) {
              final v = i < hourly.length ? hourly[i] : 0;
              final f = v > 0 && top > 0 ? (v / top * 6).ceil() / 6 : 0.08;
              return AnimatedFractionallySizedBox(
                duration: const Duration(milliseconds: 500),
                curve: Curves.easeOutExpo,
                alignment: Alignment.bottomCenter,
                heightFactor: f,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: i == current ? K.orange : v > 0 ? K.ink : K.empty,
                    borderRadius: BorderRadius.circular(1),
                  ),
                ),
              );
            }),
          ),
        ],
      ],
    );
  }
}

/// The Kaartenbak button: a black pill, or a light one with a border.
class Knop extends StatelessWidget {
  const Knop(this.label, {super.key, required this.onTap, this.light = false, this.small = false});

  final String label;
  final VoidCallback? onTap;
  final bool light, small;

  @override
  Widget build(BuildContext context) {
    final sc = uiScale(context);
    return Semantics(
      button: true,
      enabled: onTap != null,
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedOpacity(
          opacity: onTap == null ? .5 : 1,
          duration: const Duration(milliseconds: 150),
          child: Container(
            alignment: small ? null : Alignment.center,
            padding: EdgeInsets.symmetric(horizontal: (small ? 12 : 20) * sc, vertical: (small ? 7 : 14) * sc),
            decoration: BoxDecoration(
              gradient: light ? null : K.gradInk,
              color: light ? K.ground : null,
              border: light ? const Border.fromBorderSide(K.border) : null,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: K.t((small ? 13 : 15) * sc, FontWeight.w700, color: light ? K.ink : K.onInk, height: 1),
            ),
          ),
        ),
      ),
    );
  }
}
