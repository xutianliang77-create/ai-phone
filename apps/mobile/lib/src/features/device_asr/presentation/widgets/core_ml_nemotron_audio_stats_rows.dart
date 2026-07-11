import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/core_ml_nemotron_audio_diagnostic.dart';

class AudioStatsRows extends StatelessWidget {
  const AudioStatsRows({required this.details, super.key});

  final Map<String, Object?> details;

  @override
  Widget build(BuildContext context) {
    final diagnostic = coreMlNemotronAudioDiagnostic(details);
    if (diagnostic == null) return const SizedBox.shrink();
    final audio = diagnostic.audio;
    const keys = <String>[
      'sessionActive',
      'sessionError',
      'processingError',
      'inputBuffers',
      'convertedSamples',
      'conversionFailures',
      'floatExtractionFailures',
      'emittedChunks',
      'flushedTailSamples',
      'lastConversionError',
      'lastChunkRms',
      'inputSampleRate',
      'inputChannels',
    ];
    final rows = keys.where((key) => audio.containsKey(key)).toList();
    final l10n = context.l10n;
    final hint = _diagnosticHint(l10n, diagnostic.issue);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            l10n.audioInputStats,
            style: Theme.of(context).textTheme.titleSmall,
          ),
        ),
        for (final key in rows)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            title: Text(l10n.diagnosticsLabel('audio.$key')),
            subtitle: SelectableText(_formatValue(context, audio[key])),
          ),
        if (hint != null)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.info_outline),
            title: Text(l10n.warning),
            subtitle: Text(hint),
          ),
      ],
    );
  }

  String _formatValue(BuildContext context, Object? value) {
    if (value == null) return context.l10n.unknown;
    if (value is bool) return value ? context.l10n.yes : context.l10n.no;
    if (value is double) return value.toStringAsFixed(4);
    if (value is String) return context.l10n.diagnosticsValue(value);
    return value.toString();
  }

  String? _diagnosticHint(AppLocalizations l10n, String? issue) {
    return switch (issue) {
      'audio_session_error' => l10n.audioSessionErrorHint,
      'asr_processing_error' => l10n.asrProcessingErrorHint,
      'no_microphone_input' => l10n.audioNoInputHint,
      'audio_conversion_failed' => l10n.audioConversionFailureHint,
      'no_converted_samples' => l10n.audioNoConvertedSamplesHint,
      'no_asr_chunks' => l10n.audioNoAsrChunksHint,
      _ => null,
    };
  }
}
