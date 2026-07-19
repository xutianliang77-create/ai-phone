import 'package:flutter/material.dart';

import '../../data/enterprise_meeting_material_models.dart';

class EnterpriseMeetingMaterialView extends StatelessWidget {
  const EnterpriseMeetingMaterialView({
    required this.material,
    required this.canWrite,
    required this.loading,
    required this.onGenerate,
    required this.onPublish,
    required this.onEditSpeaker,
    required this.onComplete,
    super.key,
  });

  final EnterpriseMeetingMaterial material;
  final bool canWrite;
  final bool loading;
  final VoidCallback onGenerate;
  final VoidCallback onPublish;
  final void Function(String participantId, String current) onEditSpeaker;
  final void Function(EnterpriseMeetingMaterialActionItem item) onComplete;

  @override
  Widget build(BuildContext context) {
    final run = material.run;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(children: <Widget>[
          const Icon(Icons.article_outlined),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              '材料修订 ${run.revision} · ${run.sourceEventCount} 个片段',
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
          Chip(label: Text(_reviewLabel(run.reviewStatus))),
        ]),
        if (run.reviewStatus != 'ready') ...<Widget>[
          const SizedBox(height: 6),
          Text(
            run.reviewStatus == 'not_configured'
                ? 'AI 复核 Provider 未配置；仅展示服务端冻结逐字稿。'
                : run.reviewStatus == 'processing'
                    ? '复核仍在处理，可稍后重新读取。'
                    : 'AI 复核失败；未把降级内容标记为成功。',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
        if (run.retentionUntil != null)
          Text(
            '保存至 ${_time(run.retentionUntil!)}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        if (canWrite && run.status == 'draft') ...<Widget>[
          const SizedBox(height: 10),
          Wrap(spacing: 8, runSpacing: 8, children: <Widget>[
            OutlinedButton.icon(
              onPressed: loading ? null : onGenerate,
              icon: const Icon(Icons.refresh),
              label: const Text('重新生成修订'),
            ),
            FilledButton.icon(
              onPressed:
                  loading || run.reviewStatus != 'ready' ? null : onPublish,
              icon: const Icon(Icons.publish_outlined),
              label: const Text('发布'),
            ),
          ]),
          if (material.segments.isNotEmpty) _speakerSection(context),
        ],
        if (material.conclusions.isNotEmpty) _conclusions(context),
        if (material.actionItems.isNotEmpty) _actions(context),
        ExpansionTile(
          tilePadding: EdgeInsets.zero,
          leading: const Icon(Icons.subject_outlined),
          title: const Text('双语逐字稿'),
          children: material.segments
              .map((segment) => _segment(context, segment))
              .toList(growable: false),
        ),
      ],
    );
  }

  Widget _speakerSection(BuildContext context) {
    final labels = <String, String>{};
    for (final segment in material.segments) {
      labels[segment.sourceParticipantId] = segment.speakerLabel;
    }
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: labels.entries
            .map((entry) => ActionChip(
                  avatar: const Icon(Icons.edit_outlined, size: 16),
                  label: Text(entry.value),
                  onPressed: () => onEditSpeaker(entry.key, entry.value),
                ))
            .toList(growable: false),
      ),
    );
  }

  Widget _conclusions(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text('复核结论', style: Theme.of(context).textTheme.titleSmall),
            ...material.conclusions.map((item) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.summarize_outlined),
                  title: Text(item.text),
                  subtitle: Text(
                    '${_conclusionLabel(item.kind)} · '
                    '${_evidence(item.evidenceSegmentIds)}',
                  ),
                )),
          ],
        ),
      );

  Widget _actions(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text('待办', style: Theme.of(context).textTheme.titleSmall),
            ...material.actionItems.map((item) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.task_alt_outlined),
                  title: Text(item.text),
                  subtitle: Text(
                    '${item.ownerParticipantId == null ? '负责人未确认' : '负责人已关联'} · '
                    '${item.dueAt == null ? '截止时间未确认' : _time(item.dueAt!)} · '
                    '${item.priority == null ? '优先级未确认' : _priorityLabel(item.priority!)} · '
                    '${_evidence(item.evidenceSegmentIds)}',
                  ),
                  trailing: canWrite && item.status == 'open'
                      ? IconButton(
                          tooltip: '标记完成',
                          onPressed: loading ? null : () => onComplete(item),
                          icon: const Icon(Icons.check_circle_outline),
                        )
                      : Text(_actionLabel(item.status)),
                )),
          ],
        ),
      );

  Widget _segment(
    BuildContext context,
    EnterpriseMeetingMaterialSegment segment,
  ) =>
      Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border:
              Border.all(color: Theme.of(context).colorScheme.outlineVariant),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              '${segment.speakerLabel} · #${segment.ordinal + 1}',
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: 4),
            Text(segment.sourceText),
            ...segment.translations.map((value) => Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    value.text,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.outline,
                    ),
                  ),
                )),
          ],
        ),
      );

  String _evidence(List<String> ids) {
    final positions = <String, int>{
      for (final segment in material.segments) segment.id: segment.ordinal + 1,
    };
    return ids.map((id) => '片段 ${positions[id] ?? '?'}').join('、');
  }
}

String _reviewLabel(String value) => switch (value) {
      'processing' => '复核中',
      'not_configured' => '未配置复核',
      'ready' => '待人工发布',
      'failed' => '复核失败',
      _ => value,
    };
String _conclusionLabel(String value) => switch (value) {
      'summary' => '摘要',
      'topic' => '议题',
      'decision' => '决策',
      'objection' => '异议',
      'risk' => '风险',
      'unresolved' => '未解决',
      _ => value,
    };
String _actionLabel(String value) => switch (value) {
      'open' => '待处理',
      'completed' => '已完成',
      'cancelled' => '已取消',
      _ => value,
    };
String _priorityLabel(String value) => switch (value) {
      'low' => '低优先级',
      'medium' => '中优先级',
      'high' => '高优先级',
      _ => value,
    };
String _time(DateTime value) => value.toLocal().toString().substring(0, 16);
