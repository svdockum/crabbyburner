import 'package:crabbyburner/data/discovery.dart';
import 'package:crabbyburner/data/format.dart';
import 'package:crabbyburner/data/usage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'sample.dart';

void main() {
  group('Usage.fromJson', () {
    test('reads what the PC serves', () {
      final u = Usage.fromJson(sampleJson());
      expect(u.limits.plan, 'Max 5x');
      expect(u.limits.session!.percent, 24);
      expect(u.limits.session!.resetsAt, isNotNull);
      expect(u.limits.weekly!.percent, 63);
      expect(u.limits.scoped.single.label, 'Fable');
      expect(u.logsReady, isTrue);
      expect(u.today!.tokens, 507123456);
      expect(u.today!.hourly, hasLength(24));
      expect(u.last!.project, 'CrabbyBurner');
      expect(u.rpm, 7);
      expect(u.active, ['CrabbyBurner', 'adventuredoku']);
    });

    test('survives a half-empty answer', () {
      final u = Usage.fromJson({'now': 0, 'limits': {'error': 'expired', 'fetchedAt': 0}, 'logs': {'ready': false}});
      expect(u.limits.error, 'expired');
      expect(u.limits.session, isNull);
      expect(u.limits.freshAt(DateTime.now()), isFalse);
      expect(u.today, isNull);
      expect(u.last, isNull);
    });

    test('keeps limits through a short outage, drops them after 15 minutes', () {
      final at = DateTime(2026, 10, 4, 20);
      final l = Limits(error: 'network', fetchedAt: at);
      expect(l.freshAt(at.add(const Duration(minutes: 14))), isTrue);
      expect(l.freshAt(at.add(const Duration(minutes: 16))), isFalse);
    });
  });

  group('format', () {
    test('compact and grouped numbers', () {
      expect(compact(999), '999');
      expect(compact(1500), '1.5K');
      expect(compact(507123456), '507M');
      expect(compact(2397920060), '2.4B');
      expect(grouped(1342), '1,342');
    });

    test('durations', () {
      expect(span(const Duration(hours: 2, minutes: 53, seconds: 10)), '2h 53m');
      expect(span(const Duration(minutes: 8, seconds: 5)), '8m 05s');
      expect(span(const Duration(days: 4, hours: 3)), '4d 3h');
      expect(span(const Duration(seconds: -5)), '0m 00s');
      expect(ago(const Duration(seconds: 12)), '12s ago');
      expect(ago(const Duration(minutes: 90)), '1h ago');
    });

    test('when: countdown up close, weekday further out', () {
      final now = DateTime(2026, 10, 4, 20, 45);
      expect(when(now.add(const Duration(hours: 5, minutes: 2)), now), 'in 5h 2m');
      expect(when(DateTime(2026, 10, 9, 19, 59), now), 'Fri 19:59');
    });

    test('model names', () {
      expect(modelName('claude-opus-5-5'), 'Opus 5.5');
      expect(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
      expect(modelName('something-else'), 'something-else');
    });
  });

  group('discovery', () {
    test('normalizes typed addresses', () {
      expect(normalizeHost(' 192.168.2.2 '), '192.168.2.2:2722');
      expect(normalizeHost('http://192.168.2.2:3000/'), '192.168.2.2:3000');
      expect(normalizeHost('my-pc.local'), 'my-pc.local:2722');
      expect(normalizeHost(''), isNull);
      expect(normalizeHost('not an address'), isNull);
    });

    test('scans the /24 around the phone, skipping the phone itself', () {
      final c = candidates(['192.168.2.40']);
      expect(c, hasLength(253));
      expect(c, contains('192.168.2.2'));
      expect(c, isNot(contains('192.168.2.40')));
      expect(candidates(['10.0.2.15']), contains('10.0.2.2'));
    });
  });
}
