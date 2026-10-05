// App state: which PC to read, and the live feed from it (polled every five
// seconds). When the PC stops answering for half a minute, the feed looks for
// it on the Wi-Fi again, because a DHCP lease can move it to a new address.
import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'discovery.dart';
import 'usage.dart';

final prefsProvider = Provider<SharedPreferences>((ref) => throw UnimplementedError('override in main'));

class HostController extends Notifier<String?> {
  static const _key = 'server';

  @override
  String? build() => ref.watch(prefsProvider).getString(_key);

  Future<void> set(String? host) async {
    final prefs = ref.read(prefsProvider);
    if (host == null) {
      await prefs.remove(_key);
    } else {
      await prefs.setString(_key, host);
    }
    state = host;
  }
}

final hostProvider = NotifierProvider<HostController, String?>(HostController.new);

class Feed {
  const Feed({this.usage, this.lastOk, this.failures = 0, this.skew = Duration.zero, this.polls = 0});

  final Usage? usage;
  final DateTime? lastOk;
  final int failures;

  /// Server clock minus phone clock, so countdowns don't drift on a phone set wrong.
  final Duration skew;

  /// Counts successful polls; the status dot beats when it changes.
  final int polls;

  bool get offline => failures >= 2;
  DateTime now() => DateTime.now().add(skew);
}

class FeedController extends Notifier<Feed> {
  static const every = Duration(seconds: 5);

  Timer? _timer;
  http.Client? _client;
  String? _host;
  var _gen = 0;
  var _paused = false;
  DateTime? _scannedAt;

  @override
  Feed build() {
    final host = ref.watch(hostProvider);
    final gen = ++_gen;
    _host = host;
    _client = http.Client();
    final client = _client!;
    ref.onDispose(() {
      _timer?.cancel();
      client.close();
    });
    if (host != null) Future.microtask(() => _poll(host, gen));
    return const Feed();
  }

  Future<void> _poll(String host, int gen) async {
    if (gen != _gen) return;
    try {
      final res = await _client!.get(Uri.parse('http://$host/api/usage')).timeout(const Duration(seconds: 8));
      if (gen != _gen) return;
      if (res.statusCode != 200) throw http.ClientException('HTTP ${res.statusCode}');
      final usage = Usage.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
      state = Feed(
        usage: usage,
        lastOk: DateTime.now(),
        skew: usage.serverNow.difference(DateTime.now()),
        polls: state.polls + 1,
      );
    } catch (_) {
      if (gen != _gen) return;
      state = Feed(usage: state.usage, lastOk: state.lastOk, failures: state.failures + 1, skew: state.skew, polls: state.polls);
      if (state.failures >= 6) unawaited(_rediscover(host, gen));
    }
    if (gen != _gen || _paused) return;
    _timer?.cancel();
    _timer = Timer(every, () => _poll(host, gen));
  }

  Future<void> _rediscover(String host, int gen) async {
    final now = DateTime.now();
    if (_scannedAt != null && now.difference(_scannedAt!).inMinutes < 2) return;
    _scannedAt = now;
    final found = await discover();
    if (gen != _gen || found.isEmpty || found.contains(host)) return;
    await ref.read(hostProvider.notifier).set(found.first);
  }

  /// Polls straight away, after the phone changed something on the PC.
  void pollNow() {
    final host = _host;
    if (host != null && !_paused) _poll(host, _gen);
  }

  void pause() {
    _paused = true;
    _timer?.cancel();
  }

  void resume() {
    if (!_paused) return;
    _paused = false;
    final host = _host;
    if (host != null) _poll(host, _gen);
  }
}

final feedProvider = NotifierProvider<FeedController, Feed>(FeedController.new);

/// Ticks every second for the clock and the countdowns.
final clockProvider = StreamProvider<DateTime>((ref) => Stream.periodic(const Duration(seconds: 1), (_) => DateTime.now()));
