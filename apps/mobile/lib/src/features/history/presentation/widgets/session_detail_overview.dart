import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/session_history_models.dart';

class SessionDetailOverview extends StatelessWidget {
  const SessionDetailOverview({
    required this.detail,
    required this.onManageSpeakers,
    super.key,
  });

  final SessionDetail detail;
  final VoidCallback? onManageSpeakers;

  @override
  Widget build(BuildContext context) {
    final chinese = context.l10n.isChinese;
    final title = detail.title?.trim();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (title != null && title.isNotEmpty) ...<Widget>[
                  Text(title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 4),
                ],
                Text(
                  <String>[
                    _direction(chinese),
                    _duration(detail.consumedSeconds, chinese),
                    if (detail.speakerCount > 0)
                      chinese
                          ? '${detail.speakerCount} 位说话人'
                          : '${detail.speakerCount} speakers',
                  ].join(' · '),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          if (onManageSpeakers != null)
            IconButton(
              onPressed: onManageSpeakers,
              tooltip: chinese ? '管理说话人' : 'Manage speakers',
              icon: const Icon(Icons.group_outlined),
            ),
        ],
      ),
    );
  }

  String _direction(bool chinese) {
    if (detail.sourceLanguage == null || detail.targetLanguage == null) {
      return chinese ? '自动识别' : 'Auto detect';
    }
    return '${detail.sourceLanguage!.toUpperCase()} → ${detail.targetLanguage!.toUpperCase()}';
  }
}

String _duration(int seconds, bool chinese) {
  final minutes = seconds ~/ 60;
  final rest = seconds % 60;
  if (minutes == 0) return chinese ? '$rest 秒' : '${rest}s';
  return chinese ? '$minutes 分$rest 秒' : '${minutes}m ${rest}s';
}
