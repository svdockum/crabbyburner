// Number and time formatting, the same as the web page.
import 'usage.dart';

String pad(int n) => n < 10 ? '0$n' : '$n';

String hm(DateTime d) => '${pad(d.hour)}:${pad(d.minute)}';

String compact(num n) {
  const units = [('B', 1e9), ('M', 1e6), ('K', 1e3)];
  for (final (u, v) in units) {
    if (n >= v) {
      final x = n / v;
      return '${x >= 100 ? x.toStringAsFixed(0) : x.toStringAsFixed(1)}$u';
    }
  }
  return n.round().toString();
}

String grouped(num n) =>
    n.round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');

String span(Duration d) {
  final s = d.isNegative ? 0 : d.inSeconds;
  final h = s ~/ 3600, m = (s % 3600) ~/ 60;
  if (h >= 24) return '${h ~/ 24}d ${h % 24}h';
  if (h > 0) return '${h}h ${m}m';
  if (m >= 10) return '${m}m';
  return '${m}m ${pad(s % 60)}s';
}

String ago(Duration d) {
  final s = d.isNegative ? 0 : (d.inMilliseconds / 1000).round();
  if (s < 60) return '${s}s ago';
  final m = s ~/ 60;
  if (m < 60) return '${m}m ago';
  final h = m ~/ 60;
  return h < 24 ? '${h}h ago' : '${h ~/ 24}d ago';
}

const _days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/// "in 5h 2m" when it's close, otherwise "Fri 19:59".
String when(DateTime at, DateTime now) {
  final d = at.difference(now);
  return d.inHours < 20 ? 'in ${span(d)}' : '${_days[at.weekday - 1]} ${hm(at)}';
}

/// claude-opus-5-5 → Opus 5.5, claude-haiku-4-5-20251001 → Haiku 4.5
String modelName(String id) {
  final m = RegExp(r'claude-([a-z]+)-(\d+)-(\d+)').firstMatch(id);
  if (m == null) return id;
  final name = m.group(1)!;
  return '${name[0].toUpperCase()}${name.substring(1)} ${m.group(2)}.${m.group(3)}';
}

String quipFor(int p) {
  if (p < 1) return 'Fresh session. Nothing burned yet.';
  if (p < 30) return 'Plenty left in this session.';
  if (p < 60) return 'Cruising along.';
  if (p < 80) return 'Past halfway. Pace yourself.';
  if (p < 95) return 'Running hot. The crab is getting crabby.';
  if (p < 100) return 'Last few bites left.';
  return 'Cooked. The crab will wait.';
}

String _who(List<SessionRow> list) {
  final names = [for (final p in list) p.project ?? 'a session'];
  if (names.length == 1) return names.first;
  if (names.length == 2 && names[0] != names[1]) return '${names[0]} and ${names[1]}';
  return '${names.length} sessions';
}

/// What the PC does about sessions the limit cut off; it takes the quip's
/// place. Null when there's nothing to say.
String? resumeNote(Resume r) {
  final running = r.inState(RowState.running);
  if (running.isNotEmpty) return 'Continuing ${_who(running)}.';
  final stuck = [...r.inState(RowState.stuck), ...r.inState(RowState.held)];
  if (stuck.isNotEmpty) return '${_who(stuck)} won’t continue by ${stuck.length == 1 ? 'itself' : 'themselves'}.';
  final waiting = r.inState(RowState.waiting);
  if (waiting.isNotEmpty) {
    final at = waiting.map((p) => p.resetsAt!).reduce((a, b) => a.isBefore(b) ? a : b);
    return '${_who(waiting)} ${waiting.length == 1 ? 'continues' : 'continue'} at ${hm(at)}.';
  }
  final done = r.inState(RowState.done);
  final bad = done.where((p) => !p.ok).toList();
  if (bad.isNotEmpty) return 'Couldn’t continue ${_who(bad)}.';
  return done.isEmpty ? null : 'Picked up ${_who(done)} at ${hm(done.first.at!)}.';
}

/// Headline and quip when the plan limits can't be shown, keyed by the
/// server's error code.
const limitErrors = {
  'pending': ('Checking limits.', 'Asking Anthropic how much is left.'),
  'no-login': ('No login found.', 'Sign in to Claude Code on your PC to see plan limits.'),
  'expired': ('Login expired.', 'Open Claude Code on your PC; it refreshes the login itself.'),
  'network': ('Limits offline.', 'Could not reach Anthropic. Trying again in a minute.'),
  'busy': ('Limits paused.', 'Anthropic asked for a breather. Back in a few minutes.'),
  'http': ('Limits offline.', 'Anthropic answered oddly. Trying again in a minute.'),
};
