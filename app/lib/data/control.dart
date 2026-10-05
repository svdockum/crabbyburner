// Changes the phone makes on the PC: the auto-continue mode, a session's own
// switch, "continue now". The PC wants its six-digit code with each change;
// the app asks for it once per PC and keeps it.
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import 'feed.dart';

enum Sent { ok, needCode, locked, refused, offline }

class Control {
  Control(this.ref);
  final Ref ref;

  String _key(String host) => 'code:$host';

  bool hasCode() {
    final host = ref.read(hostProvider);
    return host != null && ref.read(prefsProvider).getString(_key(host)) != null;
  }

  Future<void> setCode(String? code) async {
    final host = ref.read(hostProvider);
    if (host == null) return;
    final prefs = ref.read(prefsProvider);
    if (code == null) {
      await prefs.remove(_key(host));
    } else {
      await prefs.setString(_key(host), code);
    }
  }

  /// Sends one change. With [Sent.refused], the second value is the PC's
  /// reason ('limit', 'gone', 'running', ...).
  Future<(Sent, String?)> send(Map<String, Object?> body) async {
    final host = ref.read(hostProvider);
    if (host == null) return (Sent.offline, null);
    final code = ref.read(prefsProvider).getString(_key(host));
    try {
      final res = await http
          .post(
            Uri.parse('http://$host/api/resume'),
            headers: {'Content-Type': 'application/json', 'X-Crabby-Code': ?code},
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 8));
      switch (res.statusCode) {
        case 200:
          ref.read(feedProvider.notifier).pollNow();
          return (Sent.ok, null);
        case 403:
          await setCode(null);
          return (Sent.needCode, null);
        case 429:
          return (Sent.locked, null);
      }
      String? why;
      try {
        final j = jsonDecode(res.body);
        if (j is Map && j['error'] is String) why = j['error'] as String;
      } catch (_) {}
      ref.read(feedProvider.notifier).pollNow();
      return (Sent.refused, why);
    } catch (_) {
      return (Sent.offline, null);
    }
  }
}

final controlProvider = Provider<Control>(Control.new);
