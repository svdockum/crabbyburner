// Finds the CrabbyBurner server on the local Wi-Fi: knock on port 2722 at every
// address in the phone's own /24, then ask the ones that answer for /api/usage.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

const kPort = 2722;

/// "192.168.2.2" → "192.168.2.2:2722"; strips a pasted http:// and trailing
/// slash. Returns null when it can't be a host.
String? normalizeHost(String input) {
  var s = input.trim().replaceFirst(RegExp(r'^https?://', caseSensitive: false), '');
  s = s.replaceAll(RegExp(r'/.*$'), '');
  if (s.isEmpty || !RegExp(r'^[A-Za-z0-9.\-]+(:\d{1,5})?$').hasMatch(s)) return null;
  return s.contains(':') ? s : '$s:$kPort';
}

bool _private(String ip) {
  final p = ip.split('.').map(int.tryParse).toList();
  if (p.length != 4 || p.contains(null)) return false;
  return p[0] == 10 || (p[0] == 192 && p[1] == 168) || (p[0] == 172 && p[1]! >= 16 && p[1]! <= 31);
}

/// The phone's own private IPv4 addresses, Wi-Fi first.
Future<List<String>> localAddresses() async {
  final ifs = await NetworkInterface.list(type: InternetAddressType.IPv4);
  ifs.sort((a, b) => (b.name.startsWith('wlan') ? 1 : 0) - (a.name.startsWith('wlan') ? 1 : 0));
  return [
    for (final i in ifs)
      for (final a in i.addresses)
        if (_private(a.address)) a.address,
  ];
}

/// Every other host in the same /24 as [own]. The emulator's host PC sits at
/// 10.0.2.2, which is in its own /24 anyway.
List<String> candidates(List<String> own) {
  final out = <String>{};
  for (final ip in own) {
    final prefix = ip.substring(0, ip.lastIndexOf('.'));
    for (var i = 1; i < 255; i++) {
      final c = '$prefix.$i';
      if (!own.contains(c)) out.add(c);
    }
  }
  return out.toList();
}

/// True when [host] answers /api/usage with something that looks like ours.
Future<bool> isCrabby(String host, {http.Client? client, Duration timeout = const Duration(seconds: 3)}) async {
  final c = client ?? http.Client();
  try {
    final res = await c.get(Uri.parse('http://$host/api/usage')).timeout(timeout);
    if (res.statusCode != 200) return false;
    final j = jsonDecode(res.body);
    return j is Map && j.containsKey('limits') && j.containsKey('logs');
  } catch (_) {
    return false;
  } finally {
    if (client == null) c.close();
  }
}

/// Scans the local network. [onProgress] gets (checked, total).
Future<List<String>> discover({void Function(int done, int total)? onProgress}) async {
  final hosts = candidates(await localAddresses());
  final open = <String>[];
  var done = 0, next = 0;

  Future<void> worker() async {
    while (next < hosts.length) {
      final ip = hosts[next++];
      try {
        final s = await Socket.connect(ip, kPort, timeout: const Duration(milliseconds: 450));
        s.destroy();
        open.add(ip);
      } catch (_) {
        // closed or nobody home
      }
      onProgress?.call(++done, hosts.length);
    }
  }

  await Future.wait([for (var i = 0; i < 48; i++) worker()]);
  final found = <String>[];
  for (final ip in open) {
    final host = '$ip:$kPort';
    if (await isCrabby(host)) found.add(host);
  }
  return found;
}
