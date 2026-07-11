import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/model_routing_client.dart';
import '../../data/realtime_runtime_settings.dart';

class RealtimeModelRoutingBanner extends StatelessWidget {
  const RealtimeModelRoutingBanner({
    required this.processingMode,
    required this.routing,
    required this.loading,
    required this.errorMessage,
    super.key,
  });

  final RealtimeProcessingMode processingMode;
  final ModelRoutingSnapshot? routing;
  final bool loading;
  final String? errorMessage;

  @override
  Widget build(BuildContext context) {
    if (processingMode != RealtimeProcessingMode.online) {
      return const SizedBox.shrink();
    }
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final hasIssue = errorMessage != null || routing?.status == 'not_ready';
    final scheme = theme.colorScheme;
    final profile = routing?.activeProfileInfo;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: hasIssue ? scheme.errorContainer : scheme.surface,
          border: Border.all(
            color: hasIssue ? scheme.error : theme.dividerColor,
          ),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Icon(
                    hasIssue
                        ? Icons.cloud_off_outlined
                        : Icons.account_tree_outlined,
                    color: hasIssue ? scheme.onErrorContainer : scheme.primary,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      l10n.isChinese ? '服务器模型路由' : 'Server model route',
                      style: theme.textTheme.titleSmall,
                    ),
                  ),
                  if (loading)
                    const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                _subtitle(l10n, profile),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall,
              ),
              if (profile != null) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: <Widget>[
                    _ModelPill(label: 'ASR', value: profile.asr.model),
                    _ModelPill(
                      label: l10n.isChinese ? '翻译' : 'MT',
                      value: profile.translation.model,
                    ),
                    _ModelPill(label: 'TTS', value: profile.tts.model),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _subtitle(AppLocalizations l10n, ModelRoutingProfile? profile) {
    if (errorMessage case final message?) {
      return l10n.isChinese
          ? '模型路由不可用，可切回端侧：$message'
          : 'Online model route unavailable. Switch to on-device mode: $message';
    }
    final issue =
        routing?.issues.isNotEmpty == true ? routing!.issues.first : null;
    if (issue != null) {
      return l10n.isChinese
          ? '模型路由未就绪，可切回端侧：$issue'
          : 'Online model route is not ready. Switch to on-device mode: $issue';
    }
    if (loading && profile == null) {
      return l10n.isChinese ? '正在读取在线模型配置' : 'Loading online model route';
    }
    if (profile == null) {
      return l10n.isChinese ? '未读取到在线模型配置' : 'No online model route loaded';
    }
    return profile.description ?? profile.name;
  }
}

class _ModelPill extends StatelessWidget {
  const _ModelPill({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: theme.dividerColor),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        child: Text(
          '$label $value',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: theme.textTheme.labelSmall,
        ),
      ),
    );
  }
}
