import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';

class RealtimeOnlineRecoveryActions extends StatelessWidget {
  const RealtimeOnlineRecoveryActions({
    required this.visible,
    required this.onRetryOnline,
    required this.onSwitchToOnDevice,
    super.key,
  });

  final bool visible;
  final VoidCallback onRetryOnline;
  final VoidCallback onSwitchToOnDevice;

  @override
  Widget build(BuildContext context) {
    if (!visible) return const SizedBox.shrink();
    final l10n = context.l10n;
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: LayoutBuilder(
        builder: (context, constraints) {
          return Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              FilledButton.icon(
                onPressed: onRetryOnline,
                icon: const Icon(Icons.refresh),
                label: Text(l10n.isChinese ? '重试在线' : 'Retry online'),
              ),
              OutlinedButton.icon(
                onPressed: onSwitchToOnDevice,
                icon: const Icon(Icons.phone_iphone),
                label: Text(l10n.isChinese ? '切回端侧' : 'Use on device'),
              ),
              SizedBox(
                width: constraints.maxWidth,
                child: Text(
                  l10n.isChinese
                      ? '在线链路异常时可先切回端侧继续同传'
                      : 'Retry the server route or keep translating on device.',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
