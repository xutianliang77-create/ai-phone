import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/realtime_runtime_settings.dart';
import '../controllers/realtime_gateway_diagnostic.dart';

class RealtimeGatewayDiagnosticBanner extends StatelessWidget {
  const RealtimeGatewayDiagnosticBanner({
    required this.processingMode,
    required this.diagnostic,
    required this.onOpenDiagnostics,
    super.key,
  });

  final RealtimeProcessingMode processingMode;
  final RealtimeGatewayDiagnostic? diagnostic;
  final VoidCallback onOpenDiagnostics;

  @override
  Widget build(BuildContext context) {
    if (processingMode != RealtimeProcessingMode.online && diagnostic == null) {
      return const SizedBox.shrink();
    }
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final hasIssue = diagnostic != null;
    final colorScheme = theme.colorScheme;
    final labels = _diagnosticLabels(l10n, diagnostic);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: hasIssue ? colorScheme.errorContainer : colorScheme.surface,
          border: Border.all(
            color: hasIssue ? colorScheme.error : theme.dividerColor,
          ),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(
                hasIssue ? Icons.error_outline : Icons.cloud_outlined,
                color: hasIssue
                    ? colorScheme.onErrorContainer
                    : colorScheme.primary,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      l10n.isChinese ? '在线模型链路' : 'Online model pipeline',
                      style: theme.textTheme.titleSmall,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _subtitle(l10n, diagnostic),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall,
                    ),
                    if (labels.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: labels.map(_StatusPill.new).toList(),
                      ),
                    ],
                  ],
                ),
              ),
              IconButton(
                onPressed: onOpenDiagnostics,
                tooltip: l10n.deviceAsrDiagnostics,
                icon: const Icon(Icons.health_and_safety_outlined),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _subtitle(
    AppLocalizations l10n,
    RealtimeGatewayDiagnostic? diagnostic,
  ) {
    if (diagnostic != null) return l10n.errorMessage(diagnostic.displayMessage);
    return l10n.isChinese
        ? 'ASR、翻译、TTS 由服务器 Provider 处理'
        : 'ASR, translation, and TTS are handled by server providers';
  }

  List<String> _diagnosticLabels(
    AppLocalizations l10n,
    RealtimeGatewayDiagnostic? diagnostic,
  ) {
    if (diagnostic == null) return const <String>[];
    return <String>[
      if (_stageLabel(l10n, diagnostic.stage) case final stage?) stage,
      if (diagnostic.provider case final provider? when provider.isNotEmpty)
        provider,
      if (diagnostic.isRetryable) l10n.isChinese ? '可重试' : 'Retryable',
      if (diagnostic.code case final code? when code.isNotEmpty) code,
    ];
  }

  String? _stageLabel(AppLocalizations l10n, String? stage) {
    return switch (stage) {
      'connection' => l10n.isChinese ? '实时连接' : 'Connection',
      'session' => l10n.isChinese ? '会话' : 'Session',
      'provider' => l10n.isChinese ? '在线模型' : 'Provider',
      'asr' => l10n.isChinese ? 'ASR 识别' : 'ASR',
      'translation' => l10n.isChinese ? '翻译' : 'Translation',
      'tts' => l10n.isChinese ? 'TTS 朗读' : 'TTS',
      _ => null,
    };
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill(this.label);

  final String label;

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
        child: Text(label, style: theme.textTheme.labelSmall),
      ),
    );
  }
}
