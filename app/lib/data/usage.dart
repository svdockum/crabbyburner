// The JSON the PC serves at /api/usage (see src/server.mjs), parsed defensively:
// a missing or odd field becomes null, never a crash on the desk.

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
double? _num(Object? v) => v is num ? v.toDouble() : null;
int _int(Object? v) => v is num ? v.round() : 0;
Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};

class LimitPart {
  const LimitPart(this.percent, this.resetsAt);
  final double percent;
  final DateTime? resetsAt;

  static LimitPart? from(Object? j) {
    final m = _map(j);
    final p = _num(m['percent']);
    return p == null ? null : LimitPart(p, _date(m['resetsAt']));
  }
}

class Scoped {
  const Scoped(this.label, this.percent);
  final String label;
  final double percent;
}

class Limits {
  const Limits({this.error, this.fetchedAt, this.plan, this.session, this.weekly, this.scoped = const []});
  final String? error;
  final DateTime? fetchedAt;
  final String? plan;
  final LimitPart? session, weekly;
  final List<Scoped> scoped;

  factory Limits.from(Object? j) {
    final m = _map(j);
    final at = _int(m['fetchedAt']);
    return Limits(
      error: m['error'] as String?,
      fetchedAt: at > 0 ? DateTime.fromMillisecondsSinceEpoch(at) : null,
      plan: m['plan'] as String?,
      session: LimitPart.from(m['session']),
      weekly: LimitPart.from(m['weekly']),
      scoped: [
        for (final s in (m['scoped'] is List ? m['scoped'] as List : const []))
          if (_num(_map(s)['percent']) case final p?) Scoped((_map(s)['label'] as String?) ?? 'Model', p),
      ],
    );
  }

  /// Numbers stay on screen through a short outage, but not forever.
  bool freshAt(DateTime now) => error == null || (fetchedAt != null && now.difference(fetchedAt!).inMinutes < 15);
}

class Today {
  const Today({this.tokens = 0, this.output = 0, this.replies = 0, this.hourly = const []});
  final int tokens, output, replies;
  final List<int> hourly;

  factory Today.from(Object? j) {
    final m = _map(j);
    final h = m['hourly'] is List ? (m['hourly'] as List).map(_int).toList() : <int>[];
    return Today(tokens: _int(m['tokens']), output: _int(m['output']), replies: _int(m['replies']), hourly: h);
  }
}

class LastReply {
  const LastReply(this.at, this.project, this.model);
  final DateTime at;
  final String? project;
  final String model;
}

DateTime? _ms(Object? v) => v is num && v > 0 ? DateTime.fromMillisecondsSinceEpoch(v.round()) : null;

/// Where a session stands with auto-continue, most pressing first:
/// stuck: cut off and won't continue by itself whatever the setting (see [SessionRow.reason]);
/// held: cut off, and switched off (or auto-continue is off);
/// running: being continued now; waiting: continues after the reset;
/// done: picked up in the last hour; active: replied recently, not cut off.
enum RowState { stuck, held, running, waiting, done, active }

class SessionRow {
  const SessionRow({
    required this.id,
    required this.state,
    this.project,
    this.auto = false,
    this.pick,
    this.at,
    this.cutAt,
    this.resetsAt,
    this.reason,
    this.error,
    this.ok = true,
  });

  final String id;
  final RowState state;
  final String? project;

  /// Continues by itself when cut off, after the mode and [pick].
  final bool auto;

  /// This session's own switch; null follows the mode.
  final bool? pick;

  /// Started (running), picked up (done) or last reply (active).
  final DateTime? at;
  final DateTime? cutAt, resetsAt;

  /// Why a stuck one won't go: 'tries', 'late' or 'failed' (then [error]).
  final String? reason, error;
  final bool ok;

  bool get cut => cutAt != null;

  static SessionRow? from(Object? j) {
    final m = _map(j);
    final id = m['id'];
    final state = RowState.values.asNameMap()[m['state']];
    if (id is! String || state == null) return null;
    return SessionRow(
      id: id,
      state: state,
      project: m['project'] as String?,
      auto: m['auto'] == true,
      pick: m['pick'] is bool ? m['pick'] as bool : null,
      at: _ms(m['at']),
      cutAt: _ms(m['cutAt']),
      resetsAt: _ms(m['resetsAt']),
      reason: m['reason'] as String?,
      error: m['error'] as String?,
      ok: m['ok'] != false,
    );
  }
}

/// Auto-continue: the mode ('all', 'pick', 'off') and the sessions it applies to.
class Resume {
  const Resume({this.mode = 'all', this.sessions = const []});
  final String mode;
  final List<SessionRow> sessions;

  List<SessionRow> inState(RowState s) => sessions.where((r) => r.state == s).toList();

  /// Cut off and not going to continue by itself: worth a look.
  int get attention => sessions.where((r) => r.state == RowState.stuck || r.state == RowState.held).length;

  factory Resume.from(Object? j) {
    final m = _map(j);
    return Resume(
      mode: m['mode'] is String ? m['mode'] as String : 'all',
      sessions: [for (final s in (m['sessions'] is List ? m['sessions'] as List : const [])) ?SessionRow.from(s)],
    );
  }
}

class Usage {
  const Usage({
    required this.serverNow,
    this.limits = const Limits(),
    this.logsReady = false,
    this.today,
    this.last,
    this.active = const [],
    this.replies2m = 0,
    this.resume = const Resume(),
  });

  final DateTime serverNow;
  final Limits limits;
  final bool logsReady;
  final Today? today;
  final LastReply? last;
  final List<String> active;
  final int replies2m;
  final Resume resume;

  double get rpm => replies2m / 2;

  factory Usage.fromJson(Map<String, dynamic> j) {
    final logs = _map(j['logs']);
    final last = _map(logs['last']);
    final lastAt = _int(last['at']);
    return Usage(
      serverNow: DateTime.fromMillisecondsSinceEpoch(_int(j['now'])),
      limits: Limits.from(j['limits']),
      logsReady: logs['ready'] == true,
      today: logs['today'] == null ? null : Today.from(logs['today']),
      last: lastAt > 0
          ? LastReply(DateTime.fromMillisecondsSinceEpoch(lastAt), last['project'] as String?, (last['model'] as String?) ?? '')
          : null,
      active: logs['active'] is List ? (logs['active'] as List).whereType<String>().toList() : const [],
      replies2m: _int(_map(logs['pulse'])['replies2m']),
      resume: Resume.from(j['resume']),
    );
  }
}
