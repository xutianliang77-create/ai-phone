import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../../app/product_capability_profile.dart';
import '../../../account/data/account_session_store.dart';
import '../../../account/presentation/pages/account_page.dart';
import '../../../billing/presentation/pages/wallet_page.dart';
import '../../../compliance/presentation/pages/compliance_center_page.dart';
import '../../../realtime/presentation/pages/realtime_preferences_page.dart';
import '../../../voice_identity/presentation/pages/voice_identity_page.dart';
import '../../../voice_profile/presentation/pages/my_voice_page.dart';
import 'help_feedback_page.dart';

class SettingsHomePage extends StatelessWidget {
  const SettingsHomePage({
    required this.config,
    this.accountSessionStore,
    this.capabilityProfile,
    super.key,
  });

  final AppConfig config;
  final AccountSessionStore? accountSessionStore;
  final ProductCapabilityProfile? capabilityProfile;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final sessionStore = accountSessionStore ?? const FileAccountSessionStore();
    final profile = capabilityProfile ?? ProductCapabilityProfile.current;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.tabMe)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: <Widget>[
            _AccountHeader(
              sessionStore: sessionStore,
              onTap: () => _open(
                context,
                AccountPage(sessionStore: sessionStore),
              ),
            ),
            const SizedBox(height: 20),
            _SettingsAction(
              icon: Icons.tune,
              title: '同传设置',
              onTap: () => _open(
                context,
                const RealtimePreferencesPage(title: '同传设置'),
              ),
            ),
            _SettingsAction(
              icon: Icons.language_outlined,
              title: '语言与行业',
              onTap: () => _open(
                context,
                const RealtimePreferencesPage(title: '语言与行业'),
              ),
            ),
            _SettingsAction(
              icon: Icons.volume_up_outlined,
              title: '朗读声音',
              onTap: () => _open(
                context,
                const RealtimePreferencesPage(title: '朗读声音'),
              ),
            ),
            _SettingsAction(
              icon: Icons.graphic_eq_outlined,
              title: l10n.myVoiceTitle,
              onTap: () => _open(
                context,
                MyVoicePage(apiBaseUrl: config.apiBaseUrl),
              ),
            ),
            if (profile.showVoiceIdentity)
              _SettingsAction(
                icon: Icons.fingerprint,
                title: '声音身份',
                onTap: () => _open(
                  context,
                  VoiceIdentityPage(apiBaseUrl: config.apiBaseUrl),
                ),
              ),
            _SettingsAction(
              icon: Icons.privacy_tip_outlined,
              title: '隐私与安全',
              onTap: () => _open(context, const ComplianceCenterPage()),
            ),
            if (profile.showBilling)
              _SettingsAction(
                icon: Icons.account_balance_wallet_outlined,
                title: '订阅与用量',
                onTap: () => _open(context, const WalletPage()),
              ),
            _SettingsAction(
              icon: Icons.help_outline,
              title: '帮助与反馈',
              onTap: () => _open(context, const HelpFeedbackPage()),
            ),
            const SizedBox(height: 24),
            _ReleaseIdentity(config: config),
          ],
        ),
      ),
    );
  }

  Future<void> _open(BuildContext context, Widget page) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(builder: (_) => page),
    );
  }
}

class _ReleaseIdentity extends StatelessWidget {
  const _ReleaseIdentity({required this.config});

  final AppConfig config;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = Theme.of(context).colorScheme;
    final version = l10n.isChinese
        ? '版本 ${config.appVersion}（构建 ${config.buildNumber}）'
        : 'Version ${config.appVersion} (Build ${config.buildNumber})';
    final edition = config.region.isDomestic
        ? l10n.domesticEditionStatus
        : l10n.internationalEditionStatus;
    final detailStyle = Theme.of(context).textTheme.bodySmall?.copyWith(
          color: colors.onSurfaceVariant,
        );

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Column(
        children: <Widget>[
          Text(l10n.appTitle, style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 4),
          Text(version, textAlign: TextAlign.center, style: detailStyle),
          const SizedBox(height: 4),
          Text(edition, textAlign: TextAlign.center, style: detailStyle),
        ],
      ),
    );
  }
}

class _AccountHeader extends StatefulWidget {
  const _AccountHeader({required this.sessionStore, required this.onTap});

  final AccountSessionStore sessionStore;
  final Future<void> Function() onTap;

  @override
  State<_AccountHeader> createState() => _AccountHeaderState();
}

class _AccountHeaderState extends State<_AccountHeader> {
  late Future<AccountSession?> _session;

  @override
  void initState() {
    super.initState();
    _session = widget.sessionStore.load();
  }

  @override
  void didUpdateWidget(covariant _AccountHeader oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(widget.sessionStore, oldWidget.sessionStore)) {
      _session = widget.sessionStore.load();
    }
  }

  Future<void> _openAccount() async {
    await widget.onTap();
    if (!mounted) return;
    setState(() {
      _session = widget.sessionStore.load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<AccountSession?>(
      future: _session,
      builder: (context, snapshot) {
        final signedIn = snapshot.data != null;
        return ListTile(
          contentPadding: const EdgeInsets.symmetric(vertical: 8),
          leading: const CircleAvatar(
            radius: 26,
            child: Icon(Icons.person_outline),
          ),
          title: Text(
            signedIn ? '已登录' : '登录无界 AI',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          subtitle: Text(signedIn ? '个人版' : '同步记录、用量和在线服务'),
          trailing: const Icon(Icons.chevron_right),
          onTap: _openAccount,
        );
      },
    );
  }
}

class _SettingsAction extends StatelessWidget {
  const _SettingsAction({
    required this.icon,
    required this.title,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        ListTile(
          contentPadding: const EdgeInsets.symmetric(vertical: 3),
          leading: Icon(icon),
          title: Text(title),
          trailing: const Icon(Icons.chevron_right),
          onTap: onTap,
        ),
        const Divider(indent: 48, height: 1),
      ],
    );
  }
}
