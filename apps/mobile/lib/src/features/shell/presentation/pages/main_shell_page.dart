import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../history/data/session_history_repository.dart';
import '../../../history/presentation/pages/session_history_page.dart';
import '../../../realtime/presentation/pages/realtime_page.dart';
import '../../../scan/presentation/pages/scan_translation_page.dart';
import 'call_home_page.dart';
import 'settings_home_page.dart';

class MainShellPage extends StatefulWidget {
  const MainShellPage(
      {super.key, this.config, this.realtimePage, this.historyRepository});

  final AppConfig? config;
  final RealtimePage? realtimePage;
  final SessionHistoryRepository? historyRepository;

  @override
  State<MainShellPage> createState() => _MainShellPageState();
}

class _MainShellPageState extends State<MainShellPage> {
  late final AppConfig _config = widget.config ?? AppConfig.fromEnvironment();
  int _selectedIndex = 0;
  final Set<int> _builtTabs = <int>{0};

  @override
  Widget build(BuildContext context) {
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
    return switch (index) {
      0 => widget.realtimePage ?? RealtimePage(config: _config),
      1 => const CallHomePage(),
      2 => const ScanTranslationPage(),
      3 => SessionHistoryPage(repository: widget.historyRepository),
      _ => SettingsHomePage(config: _config),
    };
  }

  void _selectTab(int index) {
    setState(() {
      _selectedIndex = index;
      _builtTabs.add(index);
    });
  }
}
