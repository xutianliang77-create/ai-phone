import 'package:flutter/material.dart';
import 'dart:async';
import '../../../account/data/account_session_events.dart';
import '../../../billing/data/subscription_recovery_coordinator.dart';
import '../../../../platform/diagnostics/control_diagnostic_policy.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../history/presentation/pages/session_history_page.dart';
import '../../../realtime/presentation/pages/realtime_page.dart';
import '../../../scan/presentation/pages/scan_translation_page.dart';
import 'call_home_page.dart';
import 'settings_home_page.dart';
import 'control_diagnostic_page.dart';

class MainShellPage extends StatefulWidget {
  const MainShellPage({super.key});

  @override
  State<MainShellPage> createState() => _MainShellPageState();
}

class _MainShellPageState extends State<MainShellPage> with WidgetsBindingObserver {
  late final AppConfig _config = AppConfig.fromEnvironment();
  int _selectedIndex = 0;
  final Set<int> _builtTabs = <int>{0};
  StreamSubscription<void>? _accountChanges;
  int _accountRevision = 0;
  SubscriptionRecoveryCoordinator? _subscriptionRecovery;
  @override
  void initState() {
    super.initState();
    if (_config.onDeviceOnly) {
      WidgetsBinding.instance.addObserver(this);
      if (!controlDiagnosticReadOnly) {
        _subscriptionRecovery = SubscriptionRecoveryCoordinator()..start();
      }
      _accountChanges = AccountSessionEvents.changes.listen((_) {
      if (mounted) setState(() { _accountRevision++; _builtTabs..clear()..add(_selectedIndex); });
      _subscriptionRecovery?.retryPending();
    }); }
  }
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _subscriptionRecovery?.dispose();
    _accountChanges?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _subscriptionRecovery?.retryPending();
  }

  @override
  Widget build(BuildContext context) {
    if (controlDiagnosticReadOnly) return const ControlDiagnosticPage();
    final l10n = context.l10n;
    return Scaffold(
      body: IndexedStack(
        index: _selectedIndex,
        children: List<Widget>.generate(5, _buildTab),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: _selectTab,
        destinations: <NavigationDestination>[
          NavigationDestination(
            icon: const Icon(Icons.mic_none),
            selectedIcon: const Icon(Icons.mic),
            label: l10n.tabLive,
          ),
          NavigationDestination(
            icon: const Icon(Icons.call_outlined),
            selectedIcon: const Icon(Icons.call),
            label: l10n.tabCall,
          ),
          NavigationDestination(
            icon: const Icon(Icons.document_scanner_outlined),
            selectedIcon: const Icon(Icons.document_scanner),
            label: l10n.tabLens,
          ),
          NavigationDestination(
            icon: const Icon(Icons.history_outlined),
            selectedIcon: const Icon(Icons.history),
            label: l10n.tabRecords,
          ),
          NavigationDestination(
            icon: const Icon(Icons.person_outline),
            selectedIcon: const Icon(Icons.person),
            label: l10n.tabMe,
          ),
        ],
      ),
    );
  }

  Widget _buildTab(int index) {
    if (!_builtTabs.contains(index)) return const SizedBox.shrink();
    final page = switch (index) {
      0 => const RealtimePage(),
      1 => const CallHomePage(),
      2 => const ScanTranslationPage(),
      3 => const SessionHistoryPage(),
      _ => SettingsHomePage(config: _config),
    };
    return KeyedSubtree(key: ValueKey('$index-$_accountRevision'), child: page);
  }

  void _selectTab(int index) {
    setState(() {
      _selectedIndex = index;
      _builtTabs.add(index);
    });
  }
}
