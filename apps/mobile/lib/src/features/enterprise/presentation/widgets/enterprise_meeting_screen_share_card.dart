import 'package:flutter/material.dart';

import '../../data/enterprise_meeting_screen_share_controller.dart';

class EnterpriseMeetingScreenShareCard extends StatefulWidget {
  const EnterpriseMeetingScreenShareCard({
    required this.snapshot,
    required this.participantId,
    required this.canShare,
    required this.canForceStop,
    required this.supported,
    required this.onStart,
    required this.onStop,
    required this.onForceStop,
    super.key,
  });

  final EnterpriseMeetingScreenShareSnapshot snapshot;
  final String participantId;
  final bool canShare;
  final bool canForceStop;
  final bool supported;
  final Future<void> Function(String qualityMode) onStart;
  final Future<void> Function() onStop;
  final Future<void> Function() onForceStop;

  @override
  State<EnterpriseMeetingScreenShareCard> createState() =>
      _EnterpriseMeetingScreenShareCardState();
}

class _EnterpriseMeetingScreenShareCardState
    extends State<EnterpriseMeetingScreenShareCard> {
  String _qualityMode = 'auto';

  @override
  Widget build(BuildContext context) {
    final share = widget.snapshot.share;
    final ownsShare = share?.participantId == widget.participantId;
    final live = share != null &&
        const <String>{'active', 'paused'}.contains(share.status);
    final waiting = ownsShare &&
        widget.snapshot.operation ==
            EnterpriseMeetingScreenShareOperation.waitingForBroadcast;
    final stopping = widget.snapshot.operation ==
        EnterpriseMeetingScreenShareOperation.stopping;
    final canStart =
        widget.supported && widget.canShare && !live && !waiting && !stopping;
    final canStop = ownsShare && (live || waiting || stopping);
    final canForceStop = !ownsShare && live && widget.canForceStop && !stopping;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(children: <Widget>[
              Icon(
                Icons.mobile_screen_share_outlined,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  '共享手机屏幕',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              _StatusChip(label: _statusLabel(widget.snapshot, ownsShare)),
            ]),
            const SizedBox(height: 10),
            Text(_description(widget, ownsShare)),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: _qualityMode,
              decoration: const InputDecoration(
                labelText: '共享画质',
                prefixIcon: Icon(Icons.high_quality_outlined),
                border: OutlineInputBorder(),
              ),
              items: const <DropdownMenuItem<String>>[
                DropdownMenuItem(value: 'auto', child: Text('自动')),
                DropdownMenuItem(value: 'smooth', child: Text('流畅')),
                DropdownMenuItem(value: 'high', child: Text('高清')),
              ],
              onChanged: canStart
                  ? (value) {
                      if (value != null) setState(() => _qualityMode = value);
                    }
                  : null,
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: <Widget>[
                FilledButton.icon(
                  onPressed:
                      canStart ? () => widget.onStart(_qualityMode) : null,
                  icon: const Icon(Icons.mobile_screen_share_outlined),
                  label: const Text('开始共享'),
                ),
                OutlinedButton.icon(
                  onPressed: canStop ? widget.onStop : null,
                  icon: const Icon(Icons.stop_screen_share_outlined),
                  label: const Text('停止共享'),
                ),
                FilledButton.icon(
                  onPressed: canForceStop ? _confirmForceStop : null,
                  style: FilledButton.styleFrom(
                    backgroundColor: Theme.of(context).colorScheme.error,
                    foregroundColor: Theme.of(context).colorScheme.onError,
                  ),
                  icon: const Icon(Icons.stop_screen_share_outlined),
                  label: const Text('强制停止共享'),
                ),
              ],
            ),
            if (widget.snapshot.errorCode != null) ...<Widget>[
              const SizedBox(height: 12),
              Text(
                _errorLabel(widget.snapshot.errorCode!),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _confirmForceStop() async {
    final share = widget.snapshot.share;
    if (share == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('强制停止共享？'),
        content: Text('将停止参会者 ${share.participantId} 的第 '
            '${share.generation} 代共享，并立即撤销旧发布权限。'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认停止'),
          ),
        ],
      ),
    );
    if (confirmed == true) await widget.onForceStop();
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.primaryContainer,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(label, style: Theme.of(context).textTheme.labelMedium),
      );
}

String _statusLabel(
  EnterpriseMeetingScreenShareSnapshot snapshot,
  bool ownsShare,
) =>
    switch (snapshot.operation) {
      EnterpriseMeetingScreenShareOperation.waitingForBroadcast => '等待系统确认',
      EnterpriseMeetingScreenShareOperation.active =>
        ownsShare ? '共享中' : '他人共享中',
      EnterpriseMeetingScreenShareOperation.paused => '已暂停',
      EnterpriseMeetingScreenShareOperation.stopping => '停止中',
      EnterpriseMeetingScreenShareOperation.failed => '未就绪',
      EnterpriseMeetingScreenShareOperation.idle => '未共享',
    };

String _description(EnterpriseMeetingScreenShareCard widget, bool ownsShare) {
  if (widget.snapshot.revocation == 'pending') {
    return '旧发布身份正在服务端撤销；完成前不会发放新共享权限。';
  }
  if (widget.snapshot.operation ==
      EnterpriseMeetingScreenShareOperation.waitingForBroadcast) {
    return '请在系统授权界面确认屏幕共享；离开 App 后仍可持续共享。';
  }
  if (widget.snapshot.share != null && !ownsShare) {
    return widget.canForceStop
        ? '另一位参会者正在共享；你可确认后强制停止当前 generation。'
        : '另一位参会者正在共享，结束后你才能发起共享。';
  }
  if (!widget.supported) return '当前平台尚未配置系统级屏幕共享。';
  if (!widget.canShare) return '当前会议角色不允许发起屏幕共享。';
  if (ownsShare && widget.snapshot.share?.status == 'paused') {
    return '该共享已暂停；当前可安全停止，不提供伪造的恢复入口。';
  }
  if (ownsShare && widget.snapshot.share?.status == 'active') {
    return '系统屏幕共享正在运行，不包含系统音频。';
  }
  return '共享整个手机屏幕；RTC 凭证只保留在主 App 内存中。';
}

String _errorLabel(String code) => switch (code) {
      'replaykit_not_configured' => 'ReplayKit 扩展或 App Group 尚未配置。',
      'media_projection_not_configured' => 'MediaProjection 前台服务尚未配置。',
      'notification_permission_denied' => '必须允许前台通知，才能显示并停止屏幕共享。',
      'media_projection_permission_denied' => '未授予系统屏幕捕获权限。',
      'media_projection_monitor_unavailable' => '无法监控系统投屏状态，本次共享已安全结束。',
      'screen_share_activation_timeout' => '未在系统界面开始共享，本次共享已安全结束。',
      'screen_share_conflict' => '当前已有参会者正在共享屏幕。',
      'screen_share_forbidden' => '当前会议角色无权执行该共享操作。',
      'screen_share_revocation_pending' => '发布身份仍在撤销，服务端将继续处理。',
      _ => '屏幕共享请求失败，未伪造成功状态。',
    };
