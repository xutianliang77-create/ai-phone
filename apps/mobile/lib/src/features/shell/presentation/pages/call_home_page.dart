import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_call_link_localizations.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../ai_calling_agent/presentation/pages/ai_calling_agent_page.dart';
import '../../../call_link/presentation/pages/call_link_page.dart';
import '../../../call_link/presentation/pages/join_call_link_page.dart';
import '../../../compliance/presentation/pages/compliance_center_page.dart';
import '../../../pstn_call/presentation/pages/pstn_call_page.dart';
import '../../../type_to_speak/presentation/pages/type_to_speak_page.dart';

class CallHomePage extends StatelessWidget {
  const CallHomePage({this.config, super.key});

  final AppConfig? config;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final appConfig = config ?? AppConfig.fromEnvironment();
    return Scaffold(
      appBar: AppBar(title: Text(l10n.tabCall)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: <Widget>[
            Row(
              children: <Widget>[
                Container(
                  width: 7,
                  height: 7,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    l10n.isChinese
                        ? '连接状态将在进入通话时检查'
                        : 'Connection is checked when you enter a call',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 28),
            Text(
              l10n.isChinese ? '跨语言沟通' : 'Communication without borders',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 6),
            Text(
              l10n.isChinese
                  ? '选择一种方式开始，字幕和译音将在通话中同步。'
                  : 'Choose how to begin. Captions and translated audio stay in sync.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
            const SizedBox(height: 28),
            _CallAction(
              icon: Icons.graphic_eq,
              title: l10n.startTranslationCall,
              subtitle:
                  l10n.isChinese ? '实时听懂彼此' : 'Understand each other live',
              onTap: () => _open(context, const CallLinkPage()),
            ),
            _CallAction(
              icon: appConfig.region.isPstnEnabled
                  ? Icons.phone_forwarded_outlined
                  : Icons.phone_paused_outlined,
              title: l10n.dialPhoneNumber,
              subtitle: appConfig.region.isPstnEnabled
                  ? (l10n.isChinese
                      ? '输入号码、选择语言并确认通话告知'
                      : 'Enter a number, choose languages, and confirm disclosure')
                  : (l10n.isChinese
                      ? 'P2 灰度中 · 可查看号码、费用和开通条件'
                      : 'P2 preview · Review number, cost, and availability'),
              onTap: () => _open(
                context,
                PstnCallPage(config: appConfig),
              ),
            ),
            _CallAction(
              icon: Icons.group_outlined,
              title: l10n.joinCallLink,
              subtitle:
                  l10n.isChinese ? '加入多人翻译通话' : 'Join a multilingual call',
              onTap: () => _open(context, const JoinCallLinkPage()),
            ),
            _CallAction(
              icon: Icons.auto_awesome_outlined,
              title: l10n.aiCallingAgent,
              subtitle: l10n.isChinese
                  ? '授权后协助完成沟通'
                  : 'Delegate a call after approval',
              onTap: () => _open(context, const AiCallingAgentPage()),
            ),
            _CallAction(
              icon: Icons.keyboard_outlined,
              title: l10n.typeToSpeak,
              subtitle: l10n.isChinese
                  ? '重要信息准确传达'
                  : 'Speak important details accurately',
              onTap: () => _open(context, const TypeToSpeakPage()),
            ),
            const SizedBox(height: 8),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.shield_outlined),
              title: Text(
                  l10n.isChinese ? '通话内容由你掌控' : 'You control call content'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _open(context, const ComplianceCenterPage()),
            ),
          ],
        ),
      ),
    );
  }

  void _open(BuildContext context, Widget page) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));
  }
}

class _CallAction extends StatelessWidget {
  const _CallAction({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        ListTile(
          contentPadding: const EdgeInsets.symmetric(vertical: 8),
          leading: CircleAvatar(
            backgroundColor: Theme.of(context).colorScheme.surfaceContainerHigh,
            child: Icon(icon, color: Theme.of(context).colorScheme.onSurface),
          ),
          title: Text(title, style: Theme.of(context).textTheme.titleMedium),
          subtitle: Text(subtitle),
          trailing: const Icon(Icons.chevron_right),
          onTap: onTap,
        ),
        const Divider(indent: 56, height: 1),
      ],
    );
  }
}
