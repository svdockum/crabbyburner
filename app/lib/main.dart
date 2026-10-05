import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'data/feed.dart';
import 'ui/connect.dart';
import 'ui/dashboard.dart';
import 'ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (kReleaseMode) FlutterError.onError = (d) => debugPrint('${d.exceptionAsString()}\n${d.stack}');
  final prefs = await SharedPreferences.getInstance();
  await keepAwake();
  runApp(ProviderScope(
    overrides: [prefsProvider.overrideWithValue(prefs)],
    child: const CrabbyApp(),
  ));
}

/// A desk display: no system bars, and the screen stays on while the app is
/// open. Neither is worth crashing over on an odd phone.
Future<void> keepAwake() async {
  try {
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  } catch (e) {
    debugPrint('immersive: $e');
  }
  try {
    await WakelockPlus.enable();
  } catch (e) {
    debugPrint('wakelock: $e');
  }
}

class CrabbyApp extends ConsumerWidget {
  const CrabbyApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final host = ref.watch(hostProvider);
    return MaterialApp(
      title: 'CrabbyBurner',
      debugShowCheckedModeBanner: false,
      theme: K.theme(),
      home: host == null ? const ConnectScreen() : const DashboardScreen(),
    );
  }
}
