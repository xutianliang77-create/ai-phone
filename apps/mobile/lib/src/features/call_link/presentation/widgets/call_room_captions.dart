import 'package:flutter/material.dart';

import '../../../../app/localization/app_call_link_localizations.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../data/call_room_client.dart';

String callRoomCaptionsTailKey(List<CallRoomCaption> captions) {
  if (captions.isEmpty) return '';
  final tail = captions.last;
  return [
    captions.length.toString(),
    tail.segmentId,
    tail.sourceText ?? '',
    tail.translatedText ?? '',
    tail.ttsReady.toString(),
  ].join('|');
}

class CallRoomCaptions extends StatelessWidget {
  const CallRoomCaptions({
    required this.captions,
    required this.localRole,
    super.key,
  });

  final List<CallRoomCaption> captions;
  final String localRole;

  @override
  Widget build(BuildContext context) {
    if (captions.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const SizedBox(height: 12),
        Text(
          context.l10n.callRoomCaptions,
          style: theme.textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        for (final caption in captions)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  caption.speaker.label(
                    isChinese: context.l10n.isChinese,
                    localRole: localRole,
                  ),
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: theme.colorScheme.primary,
                  ),
                ),
                const SizedBox(height: 2),
                if (caption.sourceText != null)
                  Text(
                    caption.sourceText!,
                    style: theme.textTheme.bodyLarge,
                  ),
                if (caption.translatedText != null)
                  Text(
                    caption.translatedText!,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                if (caption.ttsReady) ...[
                  const SizedBox(height: 4),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Icon(
                        Icons.volume_up_outlined,
                        size: 16,
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          _ttsLabel(context.l10n, caption),
                          style: theme.textTheme.labelMedium?.copyWith(
                            color: theme.colorScheme.primary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }

  String _ttsLabel(AppLocalizations l10n, CallRoomCaption caption) {
    final provider = caption.ttsProvider;
    if (provider == null) return l10n.callRoomTtsReady;
    return '${l10n.callRoomTtsReady}：$provider';
  }
}
