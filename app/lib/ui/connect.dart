// Finding the PC: scans the Wi-Fi for CrabbyBurner on port 2722, with a field
// to type the address when the scan comes up empty. While it searches the crab
// is awake; when nothing turns up, it naps.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../crab/stage.dart';
import '../crab/stage_view.dart';
import '../data/discovery.dart';
import '../data/feed.dart';
import 'theme.dart';
import 'widgets.dart';

class ConnectScreen extends ConsumerStatefulWidget {
  const ConnectScreen({super.key, this.editing = false});

  /// Opened from the dashboard to switch PCs, rather than on first start.
  final bool editing;

  @override
  ConsumerState<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends ConsumerState<ConnectScreen> {
  final _stage = Stage();
  final _field = TextEditingController();
  final _focus = FocusNode();
  var _scanning = false, _testing = false;
  var _done = 0, _total = 0;
  var _found = <String>[];
  String? _error;

  @override
  void initState() {
    super.initState();
    final host = ref.read(hostProvider);
    if (host != null) _field.text = host.endsWith(':$kPort') ? host.substring(0, host.length - '$kPort'.length - 1) : host;
    _scan();
  }

  @override
  void dispose() {
    _field.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _scan() async {
    setState(() {
      _scanning = true;
      _done = _total = 0;
      _found = [];
      _error = null;
      _stage.mood = const Mood(sleepy: false);
    });
    List<String> found;
    try {
      found = await discover(onProgress: (d, t) {
        if (mounted) {
          setState(() {
            _done = d;
            _total = t;
          });
        }
      });
    } catch (_) {
      found = [];
    }
    if (!mounted) return;
    setState(() {
      _scanning = false;
      _found = found;
      _stage.mood = Mood(sleepy: found.isEmpty);
    });
    // One PC on the first start: no need to ask.
    if (found.length == 1 && !widget.editing) await _use(found.first);
  }

  Future<void> _use(String host) async {
    await ref.read(hostProvider.notifier).set(host);
    if (widget.editing && mounted) Navigator.of(context).pop();
  }

  Future<void> _connectTyped() async {
    _focus.unfocus();
    final host = normalizeHost(_field.text);
    if (host == null) {
      setState(() => _error = 'That doesn’t look like an address. Try something like 192.168.2.2.');
      return;
    }
    setState(() {
      _testing = true;
      _error = null;
    });
    final ok = await isCrabby(host);
    if (!mounted) return;
    setState(() => _testing = false);
    if (ok) {
      await _use(host);
    } else {
      setState(() => _error = 'Nothing answered at $host. Is CrabbyBurner running there?');
    }
  }

  @override
  Widget build(BuildContext context) {
    final sc = uiScale(context);
    final quiet = K.t(15 * sc, FontWeight.w500, color: K.onInkQuiet, height: 20 / 15);
    final (head, quip) = _scanning
        ? ('Looking for your PC.', 'Knocking on port $kPort around your Wi-Fi.')
        : _found.isEmpty
            ? ('No PC found.', 'Start CrabbyBurner on your PC, then search again or type its address.')
            : ('Found it.', _found.length == 1 ? 'Tap it to connect.' : 'More than one. Pick yours.');

    return Scaffold(
      body: SafeArea(
        child: GestureDetector(
          behavior: HitTestBehavior.translucent,
          onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
          child: SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: EdgeInsets.fromLTRB(16 * sc, 12 * sc, 16 * sc, 24 * sc),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  height: 32 * sc,
                  child: Row(children: [
                    CrabMark(width: 28 * sc),
                    SizedBox(width: 7 * sc),
                    Expanded(child: Text('CrabbyBurner', style: K.t(16 * sc, FontWeight.w900, spacing: -.48 * sc))),
                    if (widget.editing) Knop('Back', light: true, small: true, onTap: () => Navigator.of(context).pop()),
                  ]),
                ),
                SizedBox(height: 16 * sc),
                Kaart(
                  dark: true,
                  tab: TabPill(_scanning ? 'Searching' : 'Find your PC', kind: TabKind.hot, scale: sc),
                  padding: EdgeInsets.fromLTRB(18 * sc, 22 * sc, 18 * sc, 14 * sc),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(head, style: K.t(38 * sc, FontWeight.w900, color: K.onInk, height: .95, spacing: -1.5 * sc)),
                    SizedBox(height: 8 * sc),
                    Text(quip, style: quiet),
                    SizedBox(height: 150 * sc, child: StageView(stage: _stage)),
                    SizedBox(height: 10 * sc),
                    Text(
                      _scanning
                          ? 'Checked $_done of ${_total == 0 ? '…' : _total}'
                          : '${_found.length} found on port $kPort',
                      style: K.t(15 * sc, FontWeight.w700, color: K.onInk),
                    ),
                  ]),
                ),
                if (_found.isNotEmpty) ...[
                  SizedBox(height: 22 * sc),
                  Kaart(
                    tab: TabPill('On this Wi-Fi', kind: TabKind.hot, scale: sc),
                    child: Column(children: [
                      for (final h in _found)
                        Padding(
                          padding: EdgeInsets.only(top: 6 * sc),
                          child: Knop(h, onTap: () => _use(h)),
                        ),
                    ]),
                  ),
                ],
                SizedBox(height: 22 * sc),
                Kaart(
                  tab: TabPill('Or type it', scale: sc),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    SizedBox(height: 4 * sc),
                    TextField(
                      controller: _field,
                      focusNode: _focus,
                      keyboardType: TextInputType.url,
                      textInputAction: TextInputAction.go,
                      autocorrect: false,
                      enableSuggestions: false,
                      onSubmitted: (_) => _connectTyped(),
                      style: K.t(16 * sc, FontWeight.w400),
                      decoration: InputDecoration(
                        hintText: '192.168.2.2',
                        hintStyle: K.t(16 * sc, FontWeight.w400, color: K.quiet),
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
                    if (_error != null) ...[
                      SizedBox(height: 8 * sc),
                      Text(_error!, style: K.t(14 * sc, FontWeight.w500, color: K.hot, height: 1.35)),
                    ],
                    SizedBox(height: 12 * sc),
                    Row(children: [
                      Expanded(child: Knop(_testing ? 'Trying…' : 'Connect', onTap: _testing ? null : _connectTyped)),
                      SizedBox(width: 8 * sc),
                      Expanded(child: Knop('Search again', light: true, onTap: _scanning ? null : _scan)),
                    ]),
                  ]),
                ),
                SizedBox(height: 16 * sc),
                Text(
                  'On the PC, run npm start in the crabbyburner folder. Phone and PC need the same Wi-Fi.',
                  style: K.t(13 * sc, FontWeight.w400, color: K.quiet, height: 17 / 13),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
