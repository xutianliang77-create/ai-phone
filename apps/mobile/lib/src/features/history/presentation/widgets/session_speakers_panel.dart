import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../../shared/domain/speaker_attribution.dart';
import '../../data/session_history_models.dart';

typedef RenameSessionSpeaker = Future<void> Function(
  SpeakerAttribution speaker,
  String displayName,
);

class SessionSpeakersPanel extends StatelessWidget {
  const SessionSpeakersPanel({
    required this.detail,
    required this.onRename,
    super.key,
  });

  final SessionDetail detail;
  final RenameSessionSpeaker onRename;

  @override
  Widget build(BuildContext context) {
    final speakers = _sessionSpeakers(detail);
    if (speakers.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            context.l10n.isChinese ? '说话人' : 'Speakers',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          for (final speaker in speakers)
            Row(
              children: <Widget>[
                const Icon(Icons.record_voice_over_outlined, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${speaker.label(isChinese: context.l10n.isChinese)} · '
                    '${speaker.sourceLabel(isChinese: context.l10n.isChinese)}',
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.edit_outlined),
                  tooltip: context.l10n.isChinese ? '修改名称' : 'Rename',
                  onPressed: () => _showRenameDialog(context, speaker),
                ),
              ],
            ),
        ],
      ),
    );
  }

  Future<void> _showRenameDialog(
    BuildContext context,
    SpeakerAttribution speaker,
  ) async {
    final controller = TextEditingController(text: speaker.displayName ?? '');
    final displayName = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.l10n.isChinese ? '修改说话人名称' : 'Rename speaker'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 40,
          decoration: InputDecoration(
            labelText: context.l10n.isChinese ? '名称' : 'Name',
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(context.l10n.isChinese ? '取消' : 'Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: Text(context.l10n.isChinese ? '保存' : 'Save'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (displayName != null && displayName.isNotEmpty) {
      await onRename(speaker, displayName);
    }
  }
}

List<SpeakerAttribution> _sessionSpeakers(SessionDetail detail) {
  final speakers = <String, SpeakerAttribution>{};
  for (final segment in detail.segments) {
    final speaker = segment.speaker;
    if (speaker != null) speakers[speaker.speakerId] = speaker;
  }
  return speakers.values.toList();
}
