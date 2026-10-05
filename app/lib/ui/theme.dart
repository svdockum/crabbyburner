// "Kaartenbak" in orange: ink on apricot, one orange, one letter, every subject
// a card with a tab. Same tokens as public/style.css.
import 'package:flutter/material.dart';

abstract final class K {
  static const ground = Color(0xFFFFE6CF);
  static const ink = Color(0xFF141110);
  static const orange = Color(0xFFFF6A13);
  static const hot = Color(0xFFD9480F);
  static const marker = Color(0xFFFFC690);
  static const ice = Color(0xFF9CC7CE);
  static const quiet = Color(0xFF7A5F4C);
  static const onInk = Color(0xFFFFFFFF);
  static const onInkQuiet = Color(0xFFC9B8AC);
  static const empty = Color(0xFFF2C9A6);

  static const font = 'SchibstedGrotesk';
  static const tnum = [FontFeature.tabularFigures()];

  static const gradInk = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF2A2523), Color(0xFF141110), Color(0xFF3B1606)],
    stops: [0, .52, 1],
  );
  static const gradOrange = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFFF8A3D), Color(0xFFF0520C)],
  );

  static const shadow = [BoxShadow(color: Color(0x59141110), offset: Offset(0, 6), blurRadius: 18, spreadRadius: -14)];
  static const border = BorderSide(color: ink, width: 2);

  static TextStyle t(double size, FontWeight weight, {Color color = ink, double? height, double spacing = 0}) =>
      TextStyle(fontFamily: font, fontSize: size, fontWeight: weight, color: color, height: height, letterSpacing: spacing);

  static ThemeData theme() => ThemeData(
        useMaterial3: true,
        fontFamily: font,
        scaffoldBackgroundColor: ground,
        colorScheme: ColorScheme.fromSeed(seedColor: orange, surface: ground, primary: ink),
        textSelectionTheme: const TextSelectionThemeData(cursorColor: ink, selectionColor: marker, selectionHandleColor: orange),
        splashFactory: NoSplash.splashFactory,
      );
}

/// Tabular digits stop a ticking number from jittering, but this face also
/// widens punctuation under tnum ("21 : 11"), so only the digit runs get it.
TextSpan numSpan(String text, TextStyle style) {
  final digits = style.copyWith(fontFeatures: K.tnum);
  return TextSpan(children: [
    for (final m in RegExp(r'\d+|\D+').allMatches(text))
      TextSpan(text: m[0], style: m[0]!.codeUnitAt(0) < 58 && m[0]!.codeUnitAt(0) > 47 ? digits : style),
  ]);
}

/// Scales type and spacing a little on bigger phones, so the numbers stay
/// readable from a desk away.
double uiScale(BuildContext context) {
  final s = MediaQuery.sizeOf(context);
  return (s.shortestSide / 360).clamp(0.9, 1.5);
}
