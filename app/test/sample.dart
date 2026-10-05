// A /api/usage answer shaped like the real one from src/server.mjs.
Map<String, dynamic> sampleJson({DateTime? now, int sessionPct = 24, int lastAgoSeconds = 6}) {
  final t = now ?? DateTime(2026, 10, 4, 20, 45);
  return {
    'now': t.millisecondsSinceEpoch,
    'limits': {
      'error': null,
      'fetchedAt': t.millisecondsSinceEpoch,
      'plan': 'Max 5x',
      'session': {'percent': sessionPct, 'resetsAt': t.add(const Duration(hours: 2, minutes: 54)).toUtc().toIso8601String(), 'severity': 'normal'},
      'weekly': {'percent': 63, 'resetsAt': DateTime(2026, 10, 9, 19, 59).toUtc().toIso8601String(), 'severity': 'normal'},
      'scoped': [
        {'label': 'Fable', 'percent': 0, 'resetsAt': '2026-10-09T18:00:00+00:00'},
      ],
    },
    'logs': {
      'ready': true,
      'today': {
        'tokens': 507123456,
        'input': 2700,
        'output': 988000,
        'cacheWrite': 7300000,
        'cacheRead': 498800000,
        'replies': 1342,
        'projects': 13,
        'hourly': [102897428, 62957591, 0, 0, 0, 0, 0, 0, 211055541, 35034703, 44812273, 0, 5382124, 0, 0, 2395204, 1956165, 0, 3941940, 8800009, 27059911, 0, 0, 0],
      },
      'week': {'tokens': 2397920060, 'replies': 6904},
      'pulse': {'replies2m': 14, 'outputPerMin': 11638},
      'last': {'at': t.subtract(Duration(seconds: lastAgoSeconds)).millisecondsSinceEpoch, 'project': 'CrabbyBurner', 'model': 'claude-opus-5-5'},
      'active': ['CrabbyBurner', 'adventuredoku'],
    },
  };
}
