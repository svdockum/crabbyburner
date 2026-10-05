// The sessions screen: whether sessions the 5-hour limit cuts off continue by
// themselves (every one, only picked ones, or none), a switch per session, and
// the cut-off ones that won't continue by themselves, with why. Changes go to
// the PC, which wants its six-digit code the first time.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../crab/stage_view.dart';
import '../data/control.dart';
import '../data/feed.dart';
import '../data/format.dart';
import '../data/usage.dart';
import 'theme.dart';
import 'widgets.dart';

const _modes = [
  ('all', 'All', 'Every session.', 'Sessions the 5-hour limit cuts off continue a minute after it resets. Switch one off below to leave it be.'),
  ('pick', 'Picked', 'Only picked ones.', 'Switch on the sessions below that should continue after the reset. The rest wait for you.'),
  ('off', 'Off', 'Off.', 'Nothing continues by itself. Sessions the limit cuts off still show up here.'),
];

void openSessions(BuildContext context) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const SessionsScreen()));

class SessionsScreen extends ConsumerStatefulWidget {
  const SessionsScreen({super.key});

  @override
  ConsumerState<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends ConsumerState<SessionsScreen> {
  var _busy = false;
  String? _note;

  Future<void> _send(Map<String, Object?> body) async {
    final control = ref.read(controlProvider);
    setState(() {
      _busy = true;
      _note = null;
    });
    var (sent, why) = await control.send(body);
    if (sent == Sent.needCode && mounted) {
      final code = await showDialog<String>(context: context, builder: (_) => const _CodeDialog());
      if (code == null) {
        if (mounted) setState(() => _busy = false);
        return;
      }
      await control.setCode(code);
      (sent, why) = await control.send(body);
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _note = switch (sent) {
        Sent.ok => null,
        Sent.needCode => 'That code didn’t match. It’s in the CrabbyBurner window on your PC.',
        Sent.locked => 'Too many wrong codes. Changes are locked for ten minutes.',
        Sent.offline => 'Can’t reach your PC.',
        Sent.refused => switch (why) {
            'limit' => 'The limit hasn’t reset yet.',
            'gone' => 'It isn’t cut off any more.',
            'running' => 'It’s already continuing.',
            'session' => 'The PC doesn’t know that session any more.',
            _ => 'The PC said no.',
          },
      };
    });
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(clockProvider);
    final feed = ref.watch(feedProvider);
    final sc = uiScale(context);
    final now = feed.now();
    final r = feed.usage?.resume;
    final live = r != null && !feed.offline && !_busy;
    final mode = _modes.firstWhere((m) => m.$1 == (r?.mode ?? 'all'), orElse: () => _modes.first);
    final stuck = r == null ? <SessionRow>[] : [...r.inState(RowState.stuck), ...r.inState(RowState.held)];
    final rest = r == null ? <SessionRow>[] : r.sessions.where((s) => !stuck.contains(s)).toList();

    Widget row(SessionRow s) => _Row(
          row: s,
          mode: mode.$1,
          now: now,
          enabled: live,
          // A switch that lands on what the mode does anyway clears the session's own choice.
          onSwitch: (v) => _send({'session': s.id, 'auto': v == (mode.$1 == 'all') ? null : v}),
          onNow: () => _send({'session': s.id, 'now': true}),
        );

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.fromLTRB(16 * sc, 12 * sc, 16 * sc, 24 * sc),
          children: [
            SizedBox(
              height: 32 * sc,
              child: Row(children: [
                CrabMark(width: 28 * sc),
                SizedBox(width: 7 * sc),
                Expanded(child: Text('Sessions', style: K.t(16 * sc, FontWeight.w900, spacing: -.48 * sc))),
                Knop('Back', light: true, small: true, onTap: () => Navigator.of(context).pop()),
              ]),
            ),
            SizedBox(height: 16 * sc),
            Kaart(
              dark: true,
              tab: TabPill('Auto-continue', kind: TabKind.hot, scale: sc),
              padding: EdgeInsets.fromLTRB(18 * sc, 22 * sc, 18 * sc, 16 * sc),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(mode.$3, style: K.t(34 * sc, FontWeight.w900, color: K.onInk, height: .95, spacing: -1.3 * sc)),
                SizedBox(height: 8 * sc),
                Text(mode.$4, style: K.t(15 * sc, FontWeight.w500, color: K.onInkQuiet, height: 20 / 15)),
                SizedBox(height: 14 * sc),
                Row(children: [
                  for (final (i, m) in _modes.indexed) ...[
                    if (i > 0) SizedBox(width: 6 * sc),
                    Expanded(
                      child: _Segment(m.$2, on: m.$1 == mode.$1, onTap: live && m.$1 != mode.$1 ? () => _send({'mode': m.$1}) : null),
                    ),
                  ],
                ]),
              ]),
            ),
            if (_note != null) ...[
              SizedBox(height: 12 * sc),
              Text(_note!, style: K.t(14 * sc, FontWeight.w500, color: K.hot, height: 1.35)),
            ],
            if (stuck.isNotEmpty) ...[
              SizedBox(height: 22 * sc),
              Kaart(
                tab: TabPill('Won’t continue', kind: TabKind.hot, scale: sc),
                child: Column(children: [for (final (i, s) in stuck.indexed) _divided(i, row(s))]),
              ),
            ],
            SizedBox(height: 22 * sc),
            Kaart(
              tab: TabPill('Sessions', scale: sc),
              child: r == null || feed.offline
                  ? _Empty(feed.offline ? 'Can’t reach your PC.' : 'Connecting…')
                  : rest.isEmpty
                      ? _Empty(stuck.isEmpty ? 'No sessions in the last 3 hours.' : 'Nothing else in the last 3 hours.')
                      : Column(children: [for (final (i, s) in rest.indexed) _divided(i, row(s))]),
            ),
            SizedBox(height: 16 * sc),
            Text(
              'Sessions with a reply in the last 3 hours, and any the limit cut off in the last day. '
              'Continuing happens on the PC: to see what it did, reopen the session there from its history.',
              style: K.t(13 * sc, FontWeight.w400, color: K.quiet, height: 17 / 13),
            ),
          ],
        ),
      ),
    );
  }

  Widget _divided(int i, Widget child) => i == 0
      ? child
      : DecoratedBox(
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: K.empty, width: 1.5))),
          child: child,
        );
}

/// One session: name, where it stands, and its switch or a "Continue now".
class _Row extends StatelessWidget {
  const _Row({required this.row, required this.mode, required this.now, required this.enabled, required this.onSwitch, required this.onNow});

  final SessionRow row;
  final String mode;
  final DateTime now;
  final bool enabled;
  final ValueChanged<bool> onSwitch;
  final VoidCallback onNow;

  String get _status {
    final s = row;
    final cut = s.cutAt == null ? 'Cut off' : 'Cut off at ${hm(s.cutAt!)}';
    final reset = s.resetsAt == null ? '' : hm(s.resetsAt!);
    return switch (s.state) {
      RowState.stuck => switch (s.reason) {
          'tries' => '$cut · tried 3 times, stopped trying',
          'late' => '$cut · the reset at $reset was hours ago',
          _ => '$cut · couldn’t continue',
        },
      RowState.held => '$cut · resets $reset · ${mode == 'off' ? 'auto-continue is off' : 'switched off'}',
      RowState.waiting => '$cut · continues after $reset',
      RowState.running => 'Continuing since ${s.at == null ? 'just now' : hm(s.at!)}',
      RowState.done => s.ok ? 'Picked up at ${hm(s.at!)}' : 'Continued at ${hm(s.at!)}, then stopped with an error',
      RowState.active => s.at == null ? 'Recent' : 'Last reply ${ago(now.difference(s.at!))}',
    };
  }

  @override
  Widget build(BuildContext context) {
    final sc = uiScale(context);
    final s = row;
    final resetPassed = s.resetsAt != null && !now.isBefore(s.resetsAt!);
    final canNow = resetPassed && (s.state == RowState.stuck || (s.state == RowState.held && mode == 'off'));
    final canSwitch = mode != 'off' && const [RowState.held, RowState.waiting, RowState.active].contains(s.state);
    final attention = s.state == RowState.stuck || s.state == RowState.held;
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 10 * sc),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(s.project ?? 'Claude Code', maxLines: 1, overflow: TextOverflow.ellipsis, style: K.t(16 * sc, FontWeight.w700)),
            SizedBox(height: 2 * sc),
            Text.rich(
              numSpan(_status, K.t(13 * sc, FontWeight.w500, color: attention ? K.hot : K.quiet, height: 17 / 13)),
            ),
            if (s.error != null) ...[
              SizedBox(height: 2 * sc),
              Text(s.error!, maxLines: 2, overflow: TextOverflow.ellipsis, style: K.t(12 * sc, FontWeight.w400, color: K.quiet, height: 16 / 12)),
            ],
          ]),
        ),
        if (canNow) ...[SizedBox(width: 10 * sc), Knop('Continue now', small: true, onTap: enabled ? onNow : null)],
        if (canSwitch) ...[
          SizedBox(width: 10 * sc),
          _Switch(on: s.auto, onChanged: enabled ? onSwitch : null, label: 'Auto-continue ${s.project ?? 'this session'}'),
        ],
      ]),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    final sc = uiScale(context);
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 10 * sc),
      child: Text(text, style: K.t(15 * sc, FontWeight.w500, color: K.quiet)),
    );
  }
}

/// One of the three mode buttons on the dark card.
class _Segment extends StatelessWidget {
  const _Segment(this.label, {required this.on, required this.onTap});

  final String label;
  final bool on;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final sc = uiScale(context);
    return Semantics(
      button: true,
      selected: on,
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          alignment: Alignment.center,
          padding: EdgeInsets.symmetric(vertical: 11 * sc),
          decoration: BoxDecoration(
            gradient: on ? K.gradOrange : null,
            border: Border.all(color: on ? K.orange : K.onInkQuiet, width: 2),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(label, style: K.t(14 * sc, FontWeight.w700, color: on ? K.ink : K.onInk, height: 1)),
        ),
      ),
    );
  }
}

/// A Kaartenbak switch: ink outline, orange when on.
class _Switch extends StatelessWidget {
  const _Switch({required this.on, required this.onChanged, required this.label});

  final bool on;
  final ValueChanged<bool>? onChanged;
  final String label;

  @override
  Widget build(BuildContext context) {
    final sc = uiScale(context);
    return Semantics(
      toggled: on,
      enabled: onChanged != null,
      label: label,
      child: GestureDetector(
        onTap: onChanged == null ? null : () => onChanged!(!on),
        child: AnimatedOpacity(
          opacity: onChanged == null ? .5 : 1,
          duration: const Duration(milliseconds: 150),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            width: 48 * sc,
            height: 28 * sc,
            padding: EdgeInsets.all(3 * sc),
            decoration: BoxDecoration(
              gradient: on ? K.gradOrange : null,
              color: on ? null : K.ground,
              border: const Border.fromBorderSide(K.border),
              borderRadius: BorderRadius.circular(999),
            ),
            child: AnimatedAlign(
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOutExpo,
              alignment: on ? Alignment.centerRight : Alignment.centerLeft,
              child: Container(
                width: 18 * sc,
                height: 18 * sc,
                decoration: const BoxDecoration(color: K.ink, shape: BoxShape.circle),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Asks for the code the PC prints under "Phone code".
class _CodeDialog extends StatefulWidget {
  const _CodeDialog();

  @override
  State<_CodeDialog> createState() => _CodeDialogState();
}

class _CodeDialogState extends State<_CodeDialog> {
  final _field = TextEditingController();

  @override
  void dispose() {
    _field.dispose();
    super.dispose();
  }

  void _ok() {
    if (_field.text.length == 6) Navigator.of(context).pop(_field.text);
  }

  @override
  Widget build(BuildContext context) {
    final sc = uiScale(context);
    return AlertDialog(
      backgroundColor: K.ground,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: K.border),
      title: Text('Code from your PC', style: K.t(20 * sc, FontWeight.w900, spacing: -.5 * sc)),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(
          'It’s in the CrabbyBurner window on your PC, next to “Phone code”. The app asks for it once.',
          style: K.t(14 * sc, FontWeight.w400, color: K.quiet, height: 1.35),
        ),
        SizedBox(height: 14 * sc),
        TextField(
          controller: _field,
          autofocus: true,
          keyboardType: TextInputType.number,
          textInputAction: TextInputAction.done,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
          onChanged: (_) => setState(() {}),
          onSubmitted: (_) => _ok(),
          textAlign: TextAlign.center,
          style: K.t(26 * sc, FontWeight.w700, spacing: 6 * sc).copyWith(fontFeatures: K.tnum),
          decoration: InputDecoration(
            hintText: '000000',
            hintStyle: K.t(26 * sc, FontWeight.w700, color: K.empty, spacing: 6 * sc),
            filled: true,
            fillColor: Colors.white,
            isDense: true,
            contentPadding: EdgeInsets.all(12 * sc),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(7), borderSide: K.border),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(7),
              borderSide: const BorderSide(color: K.orange, width: 2),
            ),
          ),
        ),
      ]),
      actions: [
        Knop('Cancel', light: true, small: true, onTap: () => Navigator.of(context).pop()),
        Knop('OK', small: true, onTap: _field.text.length == 6 ? _ok : null),
      ],
    );
  }
}
