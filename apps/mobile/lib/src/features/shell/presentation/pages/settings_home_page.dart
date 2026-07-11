import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../account/presentation/pages/account_page.dart';
import '../../../billing/presentation/pages/wallet_page.dart';
import '../../../compliance/presentation/pages/compliance_center_page.dart';
import '../../../voice_profile/presentation/pages/my_voice_page.dart';

class SettingsHomePage extends StatelessWidget {
  const SettingsHomePage({required this.config, super.key});

  final AppConfig config;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.tabMe)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: <Widget>[
            _EditionStatus(config: config),
            const SizedBox(height: 16),
            _FeatureAction(
              icon: Icons.account_circle_outlined,
              title: _localized(l10n, zh: '账号与登录', en: 'Account & Login'),
              subtitle: _localized(
                l10n,
                zh: '手机号登录、个人信息导出、退出和注销',
                en: 'Phone login, data export, logout, and deletion',
              ),
              onTap: () => _open(context, const AccountPage()),
            ),
            _FeatureAction(
              icon: Icons.account_balance_wallet_outlined,
              title: l10n.walletTitle,
              subtitle: l10n.walletBody,
              onTap: () => _open(context, const WalletPage()),
            ),
            _FeatureAction(
              icon: Icons.record_voice_over_outlined,
              title: l10n.myVoiceTitle,
              subtitle: l10n.myVoiceBody,
              onTap: () => _open(
                context,
                MyVoicePage(apiBaseUrl: config.apiBaseUrl),
              ),
            ),
            _FeatureAction(
              icon: Icons.privacy_tip_outlined,
              title: _localized(l10n, zh: '隐私与合规', en: 'Privacy & Compliance'),
              subtitle: _localized(
                l10n,
                zh: '隐私政策、用户协议、SDK 和模型服务商清单',
                en: 'Privacy policy, terms, SDKs, and model providers',
              ),
              onTap: () => _open(context, const ComplianceCenterPage()),
            ),
            _InfoRow(label: l10n.dataRegion, value: config.region.dataRegion),
            _InfoRow(
              label: l10n.callProviderPolicy,
              value: config.region.callProviderPolicy,
            ),
            _InfoRow(
              label: l10n.complianceProfile,
              value: config.region.complianceProfile,
            ),
            _InfoRow(
              label: l10n.modelProviders,
              value: config.region.allowedProviders.join(', '),
            ),
            _InfoRow(
              label: l10n.paymentStack,
              value: config.region.paymentStack.join(', '),
            ),
          ],
        ),
      ),
    );
  }

  void _open(BuildContext context, Widget page) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));
  }

  String _localized(AppLocalizations l10n,
      {required String zh, required String en}) {
    return l10n.isChinese ? zh : en;
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

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text(label),
      subtitle: Text(value),
      contentPadding: EdgeInsets.zero,
    );
  }
}
