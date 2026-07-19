import 'package:flutter/material.dart';

import '../../data/ai_calling_agent_api_client.dart';

class AiCallingAgentTaskList extends StatelessWidget {
  const AiCallingAgentTaskList({
    required this.drafts,
    required this.loading,
    required this.onRefresh,
    required this.onSelect,
    this.selectedDraftId,
    this.error,
    super.key,
  });

  final List<AiCallingAgentDraft> drafts;
  final bool loading;
  final VoidCallback onRefresh;
  final ValueChanged<AiCallingAgentDraft> onSelect;
  final String? selectedDraftId;
  final Object? error;

  @override
  Widget build(BuildContext context) {
    final active = drafts.where((draft) => !_isTerminal(draft.status)).toList();
    final recent = drafts.where((draft) => _isTerminal(draft.status)).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                '任务管理（${drafts.length}）',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            IconButton(
              onPressed: loading ? null : onRefresh,
              tooltip: '刷新任务',
              icon: const Icon(Icons.refresh_outlined),
            ),
          ],
        ),
        if (loading) const LinearProgressIndicator(),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              '任务加载失败，请重试。',
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        if (!loading && error == null && drafts.isEmpty)
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Text('暂无任务'),
          ),
        if (active.isNotEmpty) ...<Widget>[
          const _TaskGroupLabel('进行中的任务'),
          ...active.map((draft) => _TaskTile(
                draft: draft,
                selected: draft.id == selectedDraftId,
                status: _statusText(draft.status),
                onTap: () => onSelect(draft),
              )),
        ],
        if (recent.isNotEmpty) ...<Widget>[
          const _TaskGroupLabel('最近任务'),
          ...recent.map((draft) => _TaskTile(
                draft: draft,
                selected: draft.id == selectedDraftId,
                status: _statusText(draft.status),
                onTap: () => onSelect(draft),
              )),
        ],
      ],
    );
  }

  bool _isTerminal(String status) {
    return const <String>{'completed', 'failed', 'cancelled'}.contains(status);
  }

  String _statusText(String status) {
    return switch (status) {
      'draft' => '待确认',
      'authorized' => '已授权',
      'queued' => '排队中',
      'dispatching' => '正在拨号',
      'reconciliation_required' => '等待对账',
      'in_progress' => '通话中',
      'completed' => '已完成',
      'failed' => '失败',
      'requires_human_takeover' => '需要接管',
      'takeover_requested' => '已请求接管',
      'cancelled' => '已取消',
      _ => status,
    };
  }
}

class _TaskGroupLabel extends StatelessWidget {
  const _TaskGroupLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 4),
      child: Text(text, style: Theme.of(context).textTheme.labelLarge),
    );
  }
}

class _TaskTile extends StatelessWidget {
  const _TaskTile({
    required this.draft,
    required this.selected,
    required this.status,
    required this.onTap,
  });

  final AiCallingAgentDraft draft;
  final bool selected;
  final String status;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final title = draft.targetName?.trim();
    return Column(
      children: <Widget>[
        ListTile(
          contentPadding: EdgeInsets.zero,
          selected: selected,
          title: Text(title?.isNotEmpty == true ? title! : draft.objective),
          subtitle: Text('$status · ${draft.objective}'),
          trailing: const Icon(Icons.chevron_right),
          onTap: onTap,
        ),
        const Divider(height: 1),
      ],
    );
  }
}
