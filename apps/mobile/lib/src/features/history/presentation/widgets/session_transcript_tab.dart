import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../../app/localization/app_realtime_timeline_localizations.dart';
import '../../data/session_history_models.dart';

class SessionTranscriptTab extends StatelessWidget {
  const SessionTranscriptTab({required this.segments, super.key});

  final List<SessionSegment> segments;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      itemCount: segments.length,
      separatorBuilder: (_, __) => const Divider(height: 24),
      itemBuilder: (context, index) {
        final segment = segments[index];
        final metadata = <String>[
          if (segment.speaker != null)
            segment.speaker!.label(isChinese: context.l10n.isChinese),
          if (segment.timing?.overlap == true) context.l10n.overlappingSpeech,
          if (segment.languageProfile?.mixedLanguage == true)
            context.l10n.mixedLanguage,
        ];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            if (metadata.isNotEmpty) ...<Widget>[
              Text(
                metadata.join(' · '),
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: Theme.of(context).colorScheme.primary,
                    ),
              ),
              const SizedBox(height: 6),
            ],
            SelectableText(
              segment.sourceText,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (segment.translatedText.trim().isNotEmpty) ...<Widget>[
              const SizedBox(height: 6),
              SelectableText(
                segment.translatedText,
                style: Theme.of(context).textTheme.bodyLarge,
              ),
            ],
            if (_hasOptimization(segment)) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                context.l10n.isChinese
                    ? '原始识别：${segment.rawText}'
                    : 'Raw: ${segment.rawText}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ],
        );
      },
    );
  }

  bool _hasOptimization(SessionSegment segment) {
    final raw = segment.rawText?.trim();
    final optimized = segment.optimizedText?.trim();
    return raw != null &&
        raw.isNotEmpty &&
        optimized != null &&
        optimized.isNotEmpty &&
        raw != optimized;
  }
}
