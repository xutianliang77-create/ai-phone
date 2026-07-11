import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_call_link_localizations.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../ai_calling_agent/presentation/pages/ai_calling_agent_page.dart';
import '../../../call_link/presentation/pages/call_link_page.dart';
import '../../../call_link/presentation/pages/join_call_link_page.dart';
import '../../../history/presentation/pages/session_history_page.dart';
import '../../../realtime/presentation/pages/realtime_page.dart';
import '../../../scan/presentation/pages/scan_translation_page.dart';
import '../../../type_to_speak/presentation/pages/type_to_speak_page.dart';
import 'settings_home_page.dart';

class MainShellPage extends StatefulWidget {
  const MainShellPage({super.key});

  @override
  State<MainShellPage> createState() => _MainShellPageState();
}

class _MainShellPageState extends State<MainShellPage> {
  late final AppConfig _config = AppConfig.fromEnvironment();
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
      0 => const RealtimePage(),
      1 => _CallHomePage(config: _config),
      2 => const ScanTranslationPage(),
      3 => const SessionHistoryPage(),
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

class _CallHomePage extends StatelessWidget {
  const _CallHomePage({required this.config});

  final AppConfig config;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.tabCall)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: <Widget>[
            _EditionStatus(config: config),
            const SizedBox(height: 16),
            _FeatureAction(
              icon: Icons.link,
              title: l10n.startTranslationCall,
              subtitle: l10n.callLinkDomesticBody,
              onTap: () => _openCallLink(context),
            ),
            _FeatureAction(
              icon: Icons.keyboard_voice_outlined,
              title: l10n.typeToSpeak,
              subtitle: l10n.typeToSpeakBody,
              onTap: () => _openTypeToSpeak(context),
            ),
            _FeatureAction(
              icon: Icons.phone_disabled_outlined,
              title: l10n.dialPhoneNumber,
              subtitle: l10n.pstnDomesticUnavailable,
            ),
            _FeatureAction(
              icon: Icons.support_agent,
              title: l10n.aiCallingAgent,
              subtitle: l10n.aiAgentDomesticBody,
              onTap: () => _openAiCallingAgent(context),
            ),
            _FeatureAction(
              icon: Icons.login,
              title: l10n.joinCallLink,
              subtitle: l10n.joinCallDomesticBody,
              onTap: () => _openJoinCallLink(context),
            ),
          ],
        ),
      ),
    );
  }

  void _openCallLink(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const CallLinkPage()),
    );
  }

  void _openJoinCallLink(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const JoinCallLinkPage()),
    );
  }

  void _openTypeToSpeak(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const TypeToSpeakPage()),
    );
  }

  void _openAiCallingAgent(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const AiCallingAgentPage()),
    );
  }
}

class _EditionStatus extends StatelessWidget {
  const _EditionStatus({required this.config});

  final AppConfig config;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: <Widget>[
            const Icon(Icons.verified_user_outlined),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                config.region.isDomestic
                    ? l10n.domesticEditionStatus
                    : l10n.internationalEditionStatus,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FeatureAction extends StatelessWidget {
  const _FeatureAction({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon),
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: onTap == null ? null : const Icon(Icons.chevron_right),
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(vertical: 4),
    );
  }
}
