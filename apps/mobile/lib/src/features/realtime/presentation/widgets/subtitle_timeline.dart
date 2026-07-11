import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../../app/localization/app_realtime_timeline_localizations.dart';
import '../../../../shared/widgets/auto_follow_scroll_view.dart';
import '../../../realtime/domain/entities/subtitle_segment.dart';

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
    return Semantics(
      container: true,
      label: isCurrent ? context.l10n.currentSubtitle : null,
      child: ColoredBox(
        color: isCurrent
            ? theme.colorScheme.primaryContainer.withValues(alpha: 0.28)
            : Colors.transparent,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
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
