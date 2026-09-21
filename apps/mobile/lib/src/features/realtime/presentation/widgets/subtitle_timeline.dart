import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../../app/localization/app_realtime_timeline_localizations.dart';
import '../../../../shared/widgets/auto_follow_scroll_view.dart';
import '../../../realtime/domain/entities/subtitle_segment.dart';
import '../../../../shared/domain/speaker_attribution.dart';
import 'infinity_audio_visualizer.dart';

part 'subtitle_timeline_metadata.dart';

class SubtitleTimeline extends StatefulWidget {
  const SubtitleTimeline({
    required this.segments,
    this.visualizerActive = false,
    this.visualizerPaused = false,
    super.key,
  });

  final List<SubtitleSegment> segments;
  final bool visualizerActive;
  final bool visualizerPaused;

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
      return Stack(
        fit: StackFit.expand,
        children: <Widget>[
          IgnorePointer(
            child: InfinityAudioVisualizer(
              active: widget.visualizerActive,
              paused: widget.visualizerPaused,
            ),
          ),
          Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Text(
                context.l10n.tapStartToBegin,
                textAlign: TextAlign.center,
              ),
            ),
          ),
        ],
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
            key: ValueKey('subtitle-${widget.segments[index].id}'),
            segment: widget.segments[index],
            isCurrent: index == widget.segments.length - 1,
            visualizerActive: widget.visualizerActive,
            visualizerPaused: widget.visualizerPaused,
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
  const _SubtitleEntry({
    required this.segment,
    required this.isCurrent,
    required this.visualizerActive,
    required this.visualizerPaused,
    super.key,
  });

  final SubtitleSegment segment;
  final bool isCurrent;
  final bool visualizerActive;
  final bool visualizerPaused;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pending = _isTranslationPending(segment);
    final speaker = segment.speaker;
    final speakerLabel = speaker?.label(isChinese: context.l10n.isChinese);
    final timelineLabel = _formatTimeline(segment.timing);
    final overlap = segment.timing?.overlap == true;
    final mixedLanguage = segment.languageProfile?.mixedLanguage == true;
    final entryLabel = [
      if (isCurrent) context.l10n.currentSubtitle,
      if (speakerLabel != null) speakerLabel,
      if (timelineLabel != null) timelineLabel,
      if (overlap) context.l10n.overlappingSpeech,
      if (mixedLanguage) context.l10n.mixedLanguage,
      segment.sourceText,
      if (segment.translatedText.trim().isNotEmpty) segment.translatedText,
    ].join('，');
    return Semantics(
      container: true,
      explicitChildNodes: true,
      child: ColoredBox(
        color: isCurrent
            ? theme.colorScheme.primary.withValues(alpha: 0.035)
            : Colors.transparent,
        child: Stack(
          children: <Widget>[
            if (isCurrent)
              Positioned.fill(
                child: IgnorePointer(
                  child: InfinityAudioVisualizer(
                    active: visualizerActive,
                    paused: visualizerPaused,
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Semantics(
                    container: true,
                    label: entryLabel,
                    excludeSemantics: true,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        if (speaker != null ||
                            timelineLabel != null ||
                            overlap ||
                            mixedLanguage) ...[
                          _SegmentMetadata(
                            speaker: speaker,
                            timing: segment.timing,
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
                        Text(
                          segment.sourceText,
                          style: theme.textTheme.titleMedium,
                        ),
                        if (segment.translatedText.trim().isNotEmpty) ...[
                          const SizedBox(height: 6),
                          Text(
                            segment.translatedText,
                            style: theme.textTheme.bodyLarge?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (pending) ...[
                    const SizedBox(height: 8),
                    _TranslationPending(
                      key: ValueKey('subtitle-pending-${segment.id}'),
                      label: context.l10n.translationPending,
                      announce: isCurrent,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
