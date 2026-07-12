import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../../app/localization/app_realtime_timeline_localizations.dart';
import '../../../../shared/widgets/auto_follow_scroll_view.dart';
import '../../../realtime/domain/entities/subtitle_segment.dart';
import '../../../../shared/domain/speaker_attribution.dart';

class SubtitleTimeline extends StatefulWidget {
  const SubtitleTimeline({required this.segments, super.key});

  final List<SubtitleSegment> segments;

  @override
  State<SubtitleTimeline> createState() => _SubtitleTimelineState();
}

class _SubtitleTimelineState extends State<SubtitleTimeline> {
  int _lastSegmentCount = 0;
  String _lastTailKey = '';

  @override
  void initState() {
    super.initState();
    _rememberTail();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.segments.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Text(
            context.l10n.tapStartToBegin,
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    _rememberTail();
    return AutoFollowScrollView(
      tailKey: '$_lastSegmentCount|$_lastTailKey',
      jumpToLatestLabel: context.l10n.backToLatest,
      padding: const EdgeInsets.fromLTRB(0, 8, 0, 72),
      children: <Widget>[
        for (var index = 0; index < widget.segments.length; index++) ...[
          _SubtitleEntry(
            segment: widget.segments[index],
            isCurrent: index == widget.segments.length - 1,
          ),
          if (index != widget.segments.length - 1)
            const Divider(height: 1, indent: 16, endIndent: 16),
        ],
      ],
    );
  }

  void _rememberTail() {
    _lastSegmentCount = widget.segments.length;
    if (widget.segments.isEmpty) {
      _lastTailKey = '';
      return;
    }
    final tail = widget.segments.last;
    _lastTailKey =
        '${tail.id}|${tail.sourceText}|${tail.translatedText}|${tail.stage}';
  }
}

class _SubtitleEntry extends StatelessWidget {
  const _SubtitleEntry({required this.segment, required this.isCurrent});

  final SubtitleSegment segment;
  final bool isCurrent;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pending = _isTranslationPending(segment);
    final speaker = segment.speaker;
    final speakerLabel = speaker?.label(isChinese: context.l10n.isChinese);
    final overlap = segment.timing?.overlap == true;
    final mixedLanguage = segment.languageProfile?.mixedLanguage == true;
    return Semantics(
      container: true,
      label: [
        if (isCurrent) context.l10n.currentSubtitle,
        if (speakerLabel != null) speakerLabel,
        if (overlap) context.l10n.overlappingSpeech,
        if (mixedLanguage) context.l10n.mixedLanguage,
        segment.sourceText,
        if (segment.translatedText.trim().isNotEmpty) segment.translatedText,
      ].join('，'),
      child: ColoredBox(
        color: isCurrent
            ? theme.colorScheme.primaryContainer.withValues(alpha: 0.28)
            : Colors.transparent,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (speaker != null || overlap || mixedLanguage) ...[
                _SegmentMetadata(
                  speaker: speaker,
                  overlap: overlap,
                  mixedLanguage: mixedLanguage,
                ),
                const SizedBox(height: 6),
              ],
              if (isCurrent) ...[
                Text(
                  context.l10n.currentSubtitle,
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 6),
              ],
              Text(segment.sourceText, style: theme.textTheme.titleMedium),
              if (segment.translatedText.trim().isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(
                  segment.translatedText,
                  style: theme.textTheme.bodyLarge?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
              if (pending) ...[
                const SizedBox(height: 8),
                _TranslationPending(label: context.l10n.translationPending),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _SegmentMetadata extends StatelessWidget {
  const _SegmentMetadata({
    required this.speaker,
    required this.overlap,
    required this.mixedLanguage,
  });

  final SpeakerAttribution? speaker;
  final bool overlap;
  final bool mixedLanguage;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final speaker = this.speaker;
    final color = _speakerColor(
      theme.colorScheme,
      speaker?.speakerId ?? 'unknown',
    );
    return ExcludeSemantics(
      child: Wrap(
        spacing: 14,
        runSpacing: 6,
        children: <Widget>[
          if (speaker != null)
            Tooltip(
              message: speaker.sourceLabel(isChinese: context.l10n.isChinese),
              child: _MetadataItem(
                icon: Icons.record_voice_over_outlined,
                label: speaker.label(isChinese: context.l10n.isChinese),
                color: color,
              ),
            ),
          if (overlap)
            _MetadataItem(
              icon: Icons.groups_outlined,
              label: context.l10n.overlappingSpeech,
              color: theme.colorScheme.error,
            ),
          if (mixedLanguage)
            _MetadataItem(
              icon: Icons.translate,
              label: context.l10n.mixedLanguage,
              color: theme.colorScheme.tertiary,
            ),
        ],
      ),
    );
  }
}

class _MetadataItem extends StatelessWidget {
  const _MetadataItem({
    required this.icon,
    required this.label,
    required this.color,
  });

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 6),
        Text(
          label,
          style: Theme.of(context).textTheme.labelLarge?.copyWith(
                color: color,
                fontWeight: FontWeight.w600,
              ),
        ),
      ],
    );
  }
}

Color _speakerColor(ColorScheme colors, String speakerId) {
  const indexes = <int>[0, 1, 2, 3];
  final index = speakerId.codeUnits.fold<int>(0, (sum, unit) => sum + unit) %
      indexes.length;
  return <Color>[
    colors.primary,
    colors.tertiary,
    colors.secondary,
    colors.error,
  ][index];
}

class _TranslationPending extends StatelessWidget {
  const _TranslationPending({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.primary;
    return Semantics(
      liveRegion: true,
      label: label,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          SizedBox.square(
            dimension: 14,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: color,
            ),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              label,
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: color,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

bool _isTranslationPending(SubtitleSegment segment) {
  if (segment.sourceText.trim().isEmpty) return false;
  if (segment.translatedText.trim().isEmpty) return true;
  return segment.stage == 'asr';
}
