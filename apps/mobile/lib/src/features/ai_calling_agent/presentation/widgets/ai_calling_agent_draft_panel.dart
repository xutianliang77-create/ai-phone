import 'package:flutter/material.dart';

import '../../data/ai_calling_agent_api_client.dart';

class AiCallingAgentDraftPanel extends StatelessWidget {
  const AiCallingAgentDraftPanel({
    required this.draft,
    required this.busy,
    required this.onAuthorize,
    required this.onStart,
    required this.onRefresh,
    required this.onTakeover,
    required this.onCancel,
    super.key,
  });

  final AiCallingAgentDraft draft;
  final bool busy;
  final VoidCallback onAuthorize;
  final VoidCallback onStart;
  final VoidCallback onRefresh;
  final VoidCallback onTakeover;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final canAuthorize =
        draft.status == 'draft' && !draft.requiresHumanTakeover;
    final canStart = draft.status == 'authorized';
    final canRefresh = _startedStatus(draft.status);
    final canTakeover =
        draft.requiresHumanTakeover && draft.status != 'takeover_requested';
    final canCancel =
        draft.status == 'draft' || draft.status == 'requires_human_takeover';
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text('状态：${_statusText(draft.status)}'),
            if (draft.callId != null) ...[
              const SizedBox(height: 4),
              SelectableText('Call ID：${draft.callId}'),
            ],
            const SizedBox(height: 8),
            Text('话术预览', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            SelectableText(draft.suggestedScript),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                Chip(label: Text('风险：${_riskText(draft.riskLevel)}')),
                for (final reason in draft.riskReasons)
                  Chip(label: Text(_riskReasonText(reason))),
              ],
            ),
            if (_hasExecutionText(draft)) ...[
              const SizedBox(height: 12),
              _ExecutionText(draft: draft),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 12,
              runSpacing: 8,
              children: <Widget>[
                FilledButton.icon(
                  onPressed: busy || !canAuthorize ? null : onAuthorize,
                  icon: const Icon(Icons.verified_user_outlined),
                  label: const Text('确认授权'),
                ),
                FilledButton.icon(
                  onPressed: busy || !canStart ? null : onStart,
                  icon: const Icon(Icons.phone_forwarded_outlined),
                  label: const Text('开始执行'),
                ),
                OutlinedButton.icon(
                  onPressed: busy || !canRefresh ? null : onRefresh,
                  icon: const Icon(Icons.refresh_outlined),
                  label: const Text('刷新状态'),
                ),
                OutlinedButton.icon(
                  onPressed: busy || !canTakeover ? null : onTakeover,
                  icon: const Icon(Icons.pan_tool_alt_outlined),
                  label: const Text('人工接管'),
                ),
                OutlinedButton.icon(
                  onPressed: busy || !canCancel ? null : onCancel,
                  icon: const Icon(Icons.cancel_outlined),
                  label: const Text('取消任务'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  bool _startedStatus(String status) {
    return status == 'queued' ||
        status == 'in_progress' ||
        status == 'completed' ||
        status == 'failed';
  }

  bool _hasExecutionText(AiCallingAgentDraft draft) {
    return draft.resultSummary != null ||
        draft.failureReason != null ||
        draft.nextStep != null;
  }

  String _statusText(String status) {
    return switch (status) {
      'draft' => '待确认',
      'authorized' => '已授权',
      'queued' => '排队中',
      'in_progress' => '通话中',
      'completed' => '已完成',
      'failed' => '失败',
      'requires_human_takeover' => '需要接管',
      'takeover_requested' => '已请求接管',
      'cancelled' => '已取消',
      _ => status,
    };
  }

  String _riskText(String riskLevel) {
    return riskLevel == 'requires_human_takeover' ? '需要接管' : '低';
  }

  String _riskReasonText(String reason) {
    return switch (reason) {
      'payment' => '付款',
      'identity_verification' => '身份验证',
      'contract' => '合同',
      'medical' => '医疗',
      'legal' => '法律',
      'financial' => '金融',
      _ => reason,
    };
  }
}

class _ExecutionText extends StatelessWidget {
  const _ExecutionText({required this.draft});

  final AiCallingAgentDraft draft;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (draft.resultSummary != null) Text('结果摘要：${draft.resultSummary}'),
        if (draft.failureReason != null) Text('失败原因：${draft.failureReason}'),
        if (draft.nextStep != null) Text('下一步：${draft.nextStep}'),
      ],
    );
  }
}
