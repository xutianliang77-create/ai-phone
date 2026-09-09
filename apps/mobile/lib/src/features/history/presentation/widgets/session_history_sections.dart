import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/session_history_models.dart';

enum SessionHistoryKind { realtime, call, scan }

class SessionHistoryKindSelector extends StatelessWidget {
  const SessionHistoryKindSelector({
    required this.selected,
    required this.onSelected,
    super.key,
  });

  final SessionHistoryKind selected;
  final ValueChanged<SessionHistoryKind> onSelected;

  @override
  Widget build(BuildContext context) {
    final chinese = context.l10n.isChinese;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
      child: SegmentedButton<SessionHistoryKind>(
        showSelectedIcon: false,
        segments: <ButtonSegment<SessionHistoryKind>>[
          ButtonSegment(
              value: SessionHistoryKind.realtime,
              label: Text(chinese ? '同传' : 'Live')),
          ButtonSegment(
              value: SessionHistoryKind.call,
              label: Text(chinese ? '通话' : 'Calls')),
          ButtonSegment(
              value: SessionHistoryKind.scan,
              label: Text(chinese ? '扫描' : 'Scan')),
        ],
        selected: <SessionHistoryKind>{selected},
        onSelectionChanged: (value) => onSelected(value.first),
      ),
    );
  }
}

class SessionHistoryEmptyState extends StatelessWidget {
  const SessionHistoryEmptyState({required this.kind, super.key});

  final SessionHistoryKind kind;

  @override
  Widget build(BuildContext context) {
    final chinese = context.l10n.isChinese;
    final label = switch (kind) {
      SessionHistoryKind.realtime => chinese ? '同传' : 'live translation',
      SessionHistoryKind.call => chinese ? '通话' : 'call',
      SessionHistoryKind.scan => chinese ? '扫描' : 'scan',
    };
    return Center(
      child: Text(chinese ? '暂无$label记录' : 'No $label records yet'),
    );
  }
}

class SessionHistorySections extends StatelessWidget {
  const SessionHistorySections({
    required this.sessions,
    required this.onOpened,
    required this.onReviewOpened,
    required this.onDeleted,
    super.key,
  });

  final List<SessionListItem> sessions;
  final ValueChanged<String> onOpened;
  final ValueChanged<String> onReviewOpened;
  final ValueChanged<String> onDeleted;

  @override
  Widget build(BuildContext context) {
    final sections = _groupSessions(sessions);
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      itemCount: sections.length,
      itemBuilder: (context, index) {
        final section = sections[index];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 4),
              child: Text(
                _sectionLabel(context, section.date),
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
            ...section.sessions.map((session) => _SessionRecordTile(
                  session: session,
                  onOpened: onOpened,
                  onReviewOpened: onReviewOpened,
                  onDeleted: onDeleted,
                )),
          ],
        );
      },
    );
  }
}

class _SessionRecordTile extends StatelessWidget {
  const _SessionRecordTile({
    required this.session,
    required this.onOpened,
    required this.onReviewOpened,
    required this.onDeleted,
  });

  final SessionListItem session;
  final ValueChanged<String> onOpened;
  final ValueChanged<String> onReviewOpened;
  final ValueChanged<String> onDeleted;

  @override
  Widget build(BuildContext context) {
    final chinese = context.l10n.isChinese;
    final title = session.title?.trim();
    return Column(
      children: <Widget>[
        ListTile(
          contentPadding: EdgeInsets.zero,
          onTap: () => onOpened(session.sessionId),
          title: Text(
            title == null || title.isEmpty ? _fallbackTitle(chinese) : title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(_metadata(chinese)),
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                _time(session.createdAt),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              PopupMenuButton<String>(
                tooltip: chinese ? '更多操作' : 'More actions',
                onSelected: (value) {
                  if (value == 'review') onReviewOpened(session.sessionId);
                  if (value == 'delete') onDeleted(session.sessionId);
                },
                itemBuilder: (context) => <PopupMenuEntry<String>>[
                  PopupMenuItem(
                    value: 'review',
                    enabled: session.segmentCount > 0,
                    child: Text(chinese ? '生成会议纪要' : 'Generate notes'),
                  ),
                  PopupMenuItem(
                    value: 'delete',
                    child: Text(chinese ? '删除记录' : 'Delete record'),
                  ),
                ],
              ),
            ],
          ),
        ),
        const Divider(height: 1),
      ],
    );
  }

  String _fallbackTitle(bool chinese) => switch (session.kind) {
        'call' => chinese ? '翻译通话' : 'Translated call',
        'scan' => chinese ? '拍照翻译' : 'Photo translation',
        _ => chinese ? '实时同传' : 'Live translation',
      };

  String _metadata(bool chinese) {
    final direction = session.sourceLanguage == null ||
            session.targetLanguage == null
        ? (chinese ? '自动识别' : 'Auto detect')
        : '${_language(session.sourceLanguage!)} → ${_language(session.targetLanguage!)}';
    final people = session.speakerCount > 0
        ? (chinese
            ? '${session.speakerCount} 人'
            : '${session.speakerCount} people')
        : null;
    return <String>[
      if (session.status == 'checkpoint')
        chinese ? '未结束 · 已保存快照' : 'Unfinished · Saved snapshot',
      direction,
      _duration(session.consumedSeconds, chinese),
      if (people != null) people,
    ].join(' · ');
  }
}

class _HistorySection {
  const _HistorySection(this.date, this.sessions);
  final DateTime date;
  final List<SessionListItem> sessions;
}

List<_HistorySection> _groupSessions(List<SessionListItem> sessions) {
  final grouped = <DateTime, List<SessionListItem>>{};
  for (final session in sessions) {
    final value = session.createdAt.toLocal();
    final date = DateTime(value.year, value.month, value.day);
    grouped.putIfAbsent(date, () => <SessionListItem>[]).add(session);
  }
  return grouped.entries
      .map((entry) => _HistorySection(entry.key, entry.value))
      .toList(growable: false);
}

String _sectionLabel(BuildContext context, DateTime date) {
  final today = DateTime.now();
  final current = DateTime(today.year, today.month, today.day);
  if (date == current) return context.l10n.isChinese ? '今天' : 'Today';
  if (date == current.subtract(const Duration(days: 1))) {
    return context.l10n.isChinese ? '昨天' : 'Yesterday';
  }
  return '${date.month.toString().padLeft(2, '0')}月${date.day.toString().padLeft(2, '0')}日';
}

String _time(DateTime date) {
  final value = date.toLocal();
  return '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
}

String _duration(int seconds, bool chinese) {
  final minutes = seconds ~/ 60;
  final rest = seconds % 60;
  if (minutes == 0) return chinese ? '$rest 秒' : '${rest}s';
  return chinese ? '$minutes 分$rest 秒' : '${minutes}m ${rest}s';
}

String _language(String code) => switch (code.toLowerCase()) {
      'zh' || 'zh-cn' => '中文',
      'en' => 'English',
      'ja' => '日本語',
      'ko' => '한국어',
      'fr' => 'Français',
      'de' => 'Deutsch',
      'es' => 'Español',
      _ => code.toUpperCase(),
    };
