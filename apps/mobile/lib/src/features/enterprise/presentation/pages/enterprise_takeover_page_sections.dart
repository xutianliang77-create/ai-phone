part of 'enterprise_takeover_page.dart';

extension _EnterpriseTakeoverSections on _EnterpriseTakeoverPageState {
  Widget _takeoverHeader() => Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(children: <Widget>[
                Icon(
                  Icons.pan_tool_alt,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 10),
                Text(
                  '企业人工接管',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ]),
              const SizedBox(height: 10),
              const Text(
                '队列、claim、AI 停播栅栏和媒体状态全部来自当前租户服务端。'
                '取得数据库 claim 不等于 Provider 媒体已接通。',
              ),
            ],
          ),
        ),
      );

  Widget _errorPanel() => EnterpriseMobileStatusPanel(
        status: EnterpriseMobileStatus.notReady,
        title: '接管状态未收敛',
        description: _error!,
        traceId: _traceId,
        action: OutlinedButton.icon(
          onPressed: _acting
              ? null
              : _hasClaim
                  ? _activateWorkbench
                  : _loadQueues,
          icon: const Icon(Icons.refresh),
          label: Text(_hasClaim ? '重试激活工作台' : '重新读取'),
        ),
      );

  List<Widget> _queueSections() {
    final activeQueues = _queues.where((queue) => queue.status == 'active');
    return <Widget>[
      const SizedBox(height: 12),
      if (_loading)
        const EnterpriseMobileStatusPanel(
          status: EnterpriseMobileStatus.loading,
          description: '正在读取当前租户的客服队列和待接管会话。',
        )
      else if (activeQueues.isEmpty)
        const EnterpriseMobileStatusPanel(
          status: EnterpriseMobileStatus.empty,
          description: '当前租户没有活动客服队列。',
        )
      else ...<Widget>[
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: DropdownButtonFormField<String>(
              key: ValueKey<String?>(_selectedQueueId),
              initialValue: _selectedQueueId,
              decoration: const InputDecoration(
                labelText: '客服队列',
                prefixIcon: Icon(Icons.inbox_outlined),
              ),
              items: activeQueues
                  .map(
                    (queue) => DropdownMenuItem<String>(
                      value: queue.id,
                      child: Text(queue.name),
                    ),
                  )
                  .toList(growable: false),
              onChanged: _acting
                  ? null
                  : (value) {
                      if (value == null || value == _selectedQueueId) return;
                      _update(() {
                        _selectedQueueId = value;
                        _workItems = const [];
                      });
                      unawaited(_loadWorkItems(value));
                    },
            ),
          ),
        ),
        Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: <Widget>[
            TextButton.icon(
              onPressed: _acting || _selectedQueueId == null
                  ? null
                  : () => _loadWorkItems(_selectedQueueId!),
              icon: const Icon(Icons.refresh),
              label: const Text('刷新等待项'),
            ),
          ],
        ),
        if (_workItems.isEmpty && !_loading)
          const EnterpriseMobileStatusPanel(
            status: EnterpriseMobileStatus.empty,
            description: '当前队列没有等待接管的会话。',
          )
        else
          ..._workItems.map(_workItemCard),
      ],
    ];
  }

  Widget _workItemCard(EnterpriseMobileSupportWorkItem item) {
    final colors = Theme.of(context).colorScheme;
    return Card(
      color: item.slaBreached ? colors.errorContainer : null,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(children: <Widget>[
              Icon(
                item.slaBreached ? Icons.warning_amber : Icons.support_agent,
                color: item.slaBreached ? colors.error : colors.primary,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  item.intent ?? '待人工确认的客户会话',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              Text('P${item.priority}'),
            ]),
            const SizedBox(height: 8),
            Text(
              '等待 ${_duration(item.waitSeconds)} · '
              '${item.slaBreached ? "已超过 SLA" : "SLA 内"}',
            ),
            const SizedBox(height: 4),
            Text(
              '请求 ${_time(item.handoffRequestedAt)}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 14),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                onPressed: _acting ? null : () => _claimSession(item),
                icon: const Icon(Icons.pan_tool_alt),
                label: const Text('领取并打开工作台'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _activeClaimSections() {
    final claim = _claim!;
    final session = _session!;
    final workbench = _workbench;
    return <Widget>[
      const SizedBox(height: 12),
      _truthCard(
        icon: Icons.lock_clock,
        title: '数据库 Claim',
        value: claim.isActive ? '有效' : '已过期',
        detail: '会话 ${_short(session.id)} · '
            '租约至 ${_time(claim.leaseExpiresAt)} · v${claim.version}',
        ready: claim.isActive,
      ),
      if (workbench == null) ...<Widget>[
        EnterpriseMobileStatusPanel(
          status: EnterpriseMobileStatus.notReady,
          title: '工作台尚未激活',
          description: '数据库 claim 已取得，但尚未取得 AI 停播和媒体真值；不会显示接管成功。',
          action: Wrap(spacing: 8, children: <Widget>[
            OutlinedButton(
              onPressed: _acting ? null : _activateWorkbench,
              child: const Text('重试激活'),
            ),
            TextButton(
              onPressed: _acting ? null : _release,
              child: const Text('释放 Claim'),
            ),
          ]),
        ),
      ] else ...<Widget>[
        _truthCard(
          icon: Icons.voice_over_off,
          title: 'AI 数据库停播栅栏',
          value: _fenceLabel(workbench.aiSpeechFence.status),
          detail: '核验 ${_time(workbench.aiSpeechFence.verifiedAt)}',
          ready: workbench.aiSpeechFence.stopsNewAiSpeech,
        ),
        _mediaTruth(workbench),
        _customerCard(workbench),
        if (workbench.conversation.isNotEmpty) _conversationCard(workbench),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Wrap(
              spacing: 10,
              runSpacing: 10,
              children: <Widget>[
                OutlinedButton.icon(
                  onPressed: _acting ? null : _refreshWorkbench,
                  icon: const Icon(Icons.refresh),
                  label: const Text('刷新真值'),
                ),
                FilledButton.tonalIcon(
                  onPressed: _acting ? null : _release,
                  icon: const Icon(Icons.logout),
                  label: const Text('结束本地接管'),
                ),
              ],
            ),
          ),
        ),
      ],
    ];
  }

  Widget _mediaTruth(EnterpriseMobileSupportWorkbench workbench) {
    final media = workbench.control('mediaTakeover');
    final ready = media?.ready == true;
    return _truthCard(
      icon: ready ? Icons.headset_mic : Icons.headset_off,
      title: 'Provider 坐席媒体',
      value: ready ? '已确认加入' : '尚未就绪',
      detail: ready
          ? 'Provider 回执已通过服务端校验。'
          : media?.reasonCode ?? 'media_takeover_not_ready',
      ready: ready,
    );
  }

  Widget _customerCard(EnterpriseMobileSupportWorkbench workbench) => Card(
        child: ListTile(
          leading: const Icon(Icons.person_outline),
          title: Text(workbench.customer.displayName ?? '匿名客户'),
          subtitle: Text(
            '${workbench.customer.locale ?? "未设置语言"} · '
            '${workbench.channelType}/${workbench.channelProvider} · '
            '${workbench.communication?.status ?? workbench.channelStatus}',
          ),
        ),
      );

  Widget _conversationCard(EnterpriseMobileSupportWorkbench workbench) {
    final turns = workbench.conversation.length > 6
        ? workbench.conversation.sublist(workbench.conversation.length - 6)
        : workbench.conversation;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text('最近上下文', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            ...turns.map(
              (turn) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  '${turn.role == "customer" ? "客户" : "AI"}：${turn.text}',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _truthCard({
    required IconData icon,
    required String title,
    required String value,
    required String detail,
    required bool ready,
  }) =>
      Card(
        child: ListTile(
          leading: Icon(
            icon,
            color: ready
                ? Theme.of(context).colorScheme.primary
                : Theme.of(context).colorScheme.error,
          ),
          title: Text('$title · $value'),
          subtitle: Text(detail),
        ),
      );
}

String _duration(int seconds) {
  if (seconds < 60) return '$seconds 秒';
  final minutes = seconds ~/ 60;
  return '$minutes 分 ${seconds % 60} 秒';
}

String _time(DateTime value) => value.toLocal().toString().substring(0, 19);
String _short(String value) =>
    value.length <= 8 ? value : value.substring(0, 8);
String _fenceLabel(String value) => switch (value) {
      'stopped' => 'AI 已停止',
      'not_started' => 'AI 未启动',
      'terminal' => 'AI 已终止',
      _ => '未知',
    };
