import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../../platform/asr/asr_text_segment.dart';
import '../../../../platform/asr/mobile_asr_provider.dart';
import 'core_ml_nemotron_audio_stats_rows.dart';

class ActionBar extends StatelessWidget {
  const ActionBar({
    required this.onRefresh,
    required this.onInspect,
    required this.onPrepare,
    required this.onCheckService,
    required this.onSelfTest,
    required this.onExport,
    required this.selfTestRunning,
    super.key,
  });

  final VoidCallback? onRefresh;
  final VoidCallback? onInspect;
  final VoidCallback? onPrepare;
  final VoidCallback? onCheckService;
  final VoidCallback? onSelfTest;
  final VoidCallback? onExport;
  final bool selfTestRunning;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: <Widget>[
        FilledButton.icon(
          onPressed: onRefresh,
          icon: const Icon(Icons.refresh),
          label: Text(l10n.refresh),
        ),
        OutlinedButton.icon(
          onPressed: onInspect,
          icon: const Icon(Icons.fact_check_outlined),
          label: Text(l10n.inspectModel),
        ),
        OutlinedButton.icon(
          onPressed: onPrepare,
          icon: const Icon(Icons.memory),
          label: Text(l10n.prepareModel),
        ),
        OutlinedButton.icon(
          onPressed: onCheckService,
          icon: const Icon(Icons.cloud_done_outlined),
          label: Text(l10n.checkService),
        ),
        OutlinedButton.icon(
          onPressed: onSelfTest,
          icon: Icon(selfTestRunning ? Icons.stop_circle_outlined : Icons.mic),
          label: Text(selfTestRunning ? l10n.stopSelfTest : l10n.startSelfTest),
        ),
        OutlinedButton.icon(
          onPressed: onExport,
          icon: const Icon(Icons.ios_share),
          label: Text(l10n.exportDiagnostics),
        ),
      ],
    );
  }
}

class SelfTestPanel extends StatelessWidget {
  const SelfTestPanel({
    required this.running,
    required this.segments,
    required this.runtimeDetails,
    this.message,
    super.key,
  });

  final bool running;
  final List<AsrTextSegment> segments;
  final Map<String, Object?> runtimeDetails;
  final String? message;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        SectionTitle(l10n.microphoneSelfTest),
        if (message != null)
          StatusRow(
            label: l10n.microphoneSelfTest,
            value: l10n.runtimeMessage(message!),
          ),
        AudioStatsRows(details: runtimeDetails),
        if (segments.isEmpty)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(l10n.selfTestNoResult),
          )
        else ...[
          Padding(
            padding: const EdgeInsets.only(top: 8, bottom: 4),
            child: Text(
              l10n.selfTestResults,
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
          for (final segment in segments)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                segment.isFinal ? Icons.check_circle : Icons.more_horiz,
              ),
              title: SelectableText(segment.text),
              subtitle: Text(
                segment.isFinal ? l10n.finalResult : l10n.partialResult,
              ),
            ),
        ],
      ],
    );
  }
}

class AvailabilityRows extends StatelessWidget {
  const AvailabilityRows({required this.availability, super.key});

  final MobileAsrAvailability availability;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Column(
      children: <Widget>[
        StatusRow(
          label: l10n.diagnosticsLabel('canStart'),
          value: availability.canStart ? l10n.ready : l10n.notReady,
        ),
        StatusRow(
          label: l10n.diagnosticsLabel('reason'),
          value: l10n.diagnosticsValue(availability.reason),
        ),
        StatusRow(
          label: l10n.diagnosticsLabel('message'),
          value: l10n.runtimeMessage(availability.message),
        ),
      ],
    );
  }
}

class DetailsList extends StatelessWidget {
  const DetailsList({required this.details, super.key});

  final Map<String, Object?> details;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: _flatten(details).entries.map((entry) {
        return StatusRow(
          label: context.l10n.diagnosticsLabel(entry.key),
          value: _formatValue(context, entry.value),
        );
      }).toList(),
    );
  }

  static Map<String, Object?> _flatten(Map<String, Object?> source) {
    final values = <String, Object?>{};
    void visit(String prefix, Map<String, Object?> map) {
      for (final entry in map.entries) {
        final key = prefix.isEmpty ? entry.key : '$prefix.${entry.key}';
        final value = entry.value;
        if (value is Map) {
          visit(key, Map<String, Object?>.from(value));
        } else {
          values[key] = value;
        }
      }
    }

    visit('', source);
    return values;
  }

  static String _formatValue(BuildContext context, Object? value) {
    if (value == null) return context.l10n.unknown;
    if (value is bool) return value ? context.l10n.yes : context.l10n.no;
    if (value is String) return context.l10n.diagnosticsValue(value);
    return value.toString();
  }
}

class StatusRow extends StatelessWidget {
  const StatusRow({
    required this.label,
    required this.value,
    super.key,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(label),
      subtitle: SelectableText(value),
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 4),
      child: Text(text, style: Theme.of(context).textTheme.titleMedium),
    );
  }
}
