import 'package:crabbyburner/data/feed.dart';
import 'package:crabbyburner/data/usage.dart';
import 'package:crabbyburner/ui/dashboard.dart';
import 'package:crabbyburner/ui/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'sample.dart';

final _now = DateTime(2026, 10, 4, 20, 45);

class _FixedFeed extends FeedController {
  _FixedFeed(this.feed);
  final Feed feed;
  @override
  Feed build() => feed;
}

Future<void> pumpDashboard(WidgetTester tester, Size logical, double dpr, Feed feed) async {
  tester.view.physicalSize = logical * dpr;
  tester.view.devicePixelRatio = dpr;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({'server': '192.168.2.2:2722'});
  final prefs = await SharedPreferences.getInstance();
  await tester.pumpWidget(ProviderScope(
    overrides: [
      prefsProvider.overrideWithValue(prefs),
      feedProvider.overrideWith(() => _FixedFeed(feed)),
      clockProvider.overrideWith((ref) => Stream.value(_now)),
    ],
    child: MaterialApp(theme: K.theme(), home: const DashboardScreen()),
  ));
  await tester.pump(const Duration(seconds: 2));
}

void main() {
  final live = Feed(usage: Usage.fromJson(sampleJson(now: _now)), lastOk: _now, polls: 3, skew: _now.difference(DateTime.now()));
  final offline = Feed(usage: live.usage, lastOk: _now, failures: 3, skew: live.skew);

  const sizes = {
    'moto g54 portrait': (Size(432, 960), 2.5),
    'small portrait': (Size(360, 640), 2.0),
    'small landscape': (Size(640, 360), 2.0),
    'moto g54 landscape': (Size(960, 432), 2.5),
  };

  for (final MapEntry(key: name, value: (size, dpr)) in sizes.entries) {
    testWidgets('lays out without overflow: $name', (tester) async {
      await pumpDashboard(tester, size, dpr, live);
      expect(tester.takeException(), isNull);
      expect(find.text('This week'.toUpperCase()), findsOneWidget);
      expect(find.textContaining('burned', findRichText: true), findsOneWidget);
      expect(find.text('LIVE'), findsOneWidget);
    });
  }

  testWidgets('offline says so, and when the numbers are from', (tester) async {
    await pumpDashboard(tester, const Size(360, 640), 2, offline);
    expect(tester.takeException(), isNull);
    expect(find.text('OFFLINE'), findsOneWidget);
    expect(find.text('Numbers from 20:45. Retrying.'), findsOneWidget);
    expect(find.text('NO SIGNAL'), findsOneWidget);
  });
}
