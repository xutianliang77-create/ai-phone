part of 'subtitle_timeline.dart';

class _SegmentMetadata extends StatelessWidget {
  const _SegmentMetadata({
    required this.speaker,
    required this.timing,
    required this.overlap,
    required this.mixedLanguage,
  });

  final SpeakerAttribution? speaker;
  final SegmentTiming? timing;
  final bool overlap;
  final bool mixedLanguage;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final speaker = this.speaker;
    final timelineLabel = _formatTimeline(timing);
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
          if (timelineLabel != null)
            _MetadataItem(
              icon: Icons.schedule_outlined,
              label: timelineLabel,
              color: theme.colorScheme.onSurfaceVariant,
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

String? _formatTimeline(SegmentTiming? timing) {
  if (timing == null ||
      timing.startMs < 0 ||
      timing.endMs < timing.startMs) {
    return null;
  }
  String clock(int milliseconds) {
    final seconds = milliseconds ~/ 1000;
    final minutes = seconds ~/ 60;
    final remainderSeconds = seconds % 60;
    final remainderMs = milliseconds % 1000;
    return '${minutes.toString().padLeft(2, '0')}:'
        '${remainderSeconds.toString().padLeft(2, '0')}.'
        '${remainderMs.toString().padLeft(3, '0')}';
  }

  return '${clock(timing.startMs)}–${clock(timing.endMs)}';
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
  const _TranslationPending({
    required this.label,
    required this.announce,
    super.key,
  });

  final String label;
  final bool announce;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.primary;
    return Semantics(
      container: true,
      liveRegion: announce,
      label: label,
      excludeSemantics: true,
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
