import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../data/enterprise_meeting_calendar_api.dart';
import '../../data/enterprise_meeting_calendar_models.dart';
import '../../data/enterprise_mobile_api_client.dart';
import '../../data/enterprise_mobile_models.dart';

class EnterpriseMeetingCalendarCard extends StatefulWidget {
  const EnterpriseMeetingCalendarCard({
    required this.client,
    required this.workspace,
    required this.meetingId,
    required this.meetingVersion,
    required this.canSync,
    super.key,
  });

  final EnterpriseMobileApiClient client;
  final EnterpriseMobileWorkspace workspace;
  final String meetingId;
  final int meetingVersion;
  final bool canSync;

  @override
  State<EnterpriseMeetingCalendarCard> createState() =>
      _EnterpriseMeetingCalendarCardState();
}

class _EnterpriseMeetingCalendarCardState
    extends State<EnterpriseMeetingCalendarCard> {
  EnterpriseMobileMeetingCalendarSync? _sync;
  Timer? _timer;
  String? _error;
  int _duration = 60;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant EnterpriseMeetingCalendarCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.meetingId != widget.meetingId ||
        oldWidget.workspace.context.tenant.id !=
            widget.workspace.context.tenant.id) {
      _timer?.cancel();
      _sync = null;
      unawaited(_load());
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Divider(height: 28),
          Row(children: <Widget>[
            Icon(Icons.event_outlined,
                color: Theme.of(context).colorScheme.primary),
            const SizedBox(width: 10),
            const Expanded(child: Text('企业日历')),
            Text(_statusLabel()),
          ]),
          if (_error != null) ...<Widget>[
            const SizedBox(height: 8),
            Text(_error!, style: Theme.of(context).textTheme.bodySmall),
          ],
          if (_sync?.status == 'pending' &&
              _sync?.lastErrorCode != null) ...<Widget>[
            const SizedBox(height: 8),
            Text('Worker 将继续重试：${_sync!.lastErrorCode}',
                style: Theme.of(context).textTheme.bodySmall),
          ],
          if (!_loading && _sync == null) ...<Widget>[
            const SizedBox(height: 10),
            Wrap(
              spacing: 10,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                DropdownButton<int>(
                    value: _duration,
                    items: const <DropdownMenuItem<int>>[
                      DropdownMenuItem(value: 30, child: Text('30 分钟')),
                      DropdownMenuItem(value: 60, child: Text('1 小时')),
                      DropdownMenuItem(value: 90, child: Text('1.5 小时')),
                      DropdownMenuItem(value: 120, child: Text('2 小时')),
                    ],
                    onChanged: _loading
                        ? null
                        : (value) =>
                            setState(() => _duration = value ?? _duration)),
                OutlinedButton.icon(
                    onPressed: widget.canSync ? _submit : null,
                    icon: const Icon(Icons.sync),
                    label: const Text('同步到 Google Calendar')),
              ],
            ),
          ],
          if (_sync?.status == 'synced' &&
              _sync?.providerWebUrl != null) ...<Widget>[
            const SizedBox(height: 8),
            TextButton.icon(
                onPressed: _copyLink,
                icon: const Icon(Icons.content_copy),
                label: const Text('复制日历事件链接')),
          ],
          const SizedBox(height: 6),
          Text('仅同步主持人的无界AI会议入口；外部访客仍须单独邀请。',
              style: Theme.of(context).textTheme.bodySmall),
        ],
      );

  Future<void> _load() async {
    final tenantId = widget.workspace.context.tenant.id;
    final meetingId = widget.meetingId;
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final value = await widget.client.currentMeetingCalendarSync(
        widget.workspace,
        meetingId,
      );
      if (!_currentScope(tenantId, meetingId)) return;
      setState(() => _sync = value);
      _schedule(value);
    } catch (error) {
      if (_currentScope(tenantId, meetingId)) {
        setState(() => _error = _label(error));
      }
    } finally {
      if (_currentScope(tenantId, meetingId)) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _submit() async {
    final tenantId = widget.workspace.context.tenant.id;
    final meetingId = widget.meetingId;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final value = await widget.client.requestMeetingCalendarSync(
        widget.workspace,
        meetingId,
        expectedMeetingVersion: widget.meetingVersion,
        durationMinutes: _duration,
        idempotencyKey: _uuid(),
      );
      if (!_currentScope(tenantId, meetingId)) return;
      setState(() => _sync = value);
      _schedule(value);
    } catch (error) {
      if (_currentScope(tenantId, meetingId)) {
        setState(() => _error = _label(error));
      }
    } finally {
      if (_currentScope(tenantId, meetingId)) {
        setState(() => _loading = false);
      }
    }
  }

  bool _currentScope(String tenantId, String meetingId) =>
      mounted &&
      widget.workspace.context.tenant.id == tenantId &&
      widget.meetingId == meetingId;

  void _schedule(EnterpriseMobileMeetingCalendarSync? value) {
    _timer?.cancel();
    if (value?.status == 'pending') {
      _timer = Timer(const Duration(seconds: 5), () => unawaited(_load()));
    }
  }

  Future<void> _copyLink() async {
    await Clipboard.setData(
        ClipboardData(text: _sync!.providerWebUrl.toString()));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('日历事件链接已复制')),
      );
    }
  }

  String _statusLabel() => _loading
      ? '正在读取'
      : switch (_sync?.status) {
          'pending' => '等待 Worker',
          'synced' => '已同步',
          'failed' => '同步失败',
          _ => '尚未同步',
        };
}

String _label(Object error) {
  if (error is EnterpriseMobileApiException) {
    if (error.statusCode == 403) return '只有会议主持人可以同步日历。';
    if (error.statusCode == 409) return '会议状态已变化，请刷新后重试。';
    if (error.statusCode == 503) return '日历 Provider 尚未配置或健康检查未通过。';
  }
  return '无法读取企业日历状态。';
}

String _uuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex =
      bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
