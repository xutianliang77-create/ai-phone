import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import '../../data/enterprise_meeting_screen_ocr_api.dart';
import '../../data/enterprise_meeting_screen_ocr_models.dart';
import '../../data/enterprise_meeting_screen_share_models.dart';
import '../../data/enterprise_mobile_api_client.dart';
import '../../data/enterprise_mobile_models.dart';

class EnterpriseMeetingScreenOcrCard extends StatefulWidget {
  const EnterpriseMeetingScreenOcrCard({
    required this.client,
    required this.workspace,
    required this.meetingId,
    required this.share,
    required this.defaultLanguage,
    required this.onView,
    super.key,
  });

  final EnterpriseMobileApiClient client;
  final EnterpriseMobileWorkspace workspace;
  final String meetingId, defaultLanguage;
  final EnterpriseMobileScreenShare? share;
  final ValueChanged<EnterpriseMobileScreenOcrView?> onView;

  @override
  State<EnterpriseMeetingScreenOcrCard> createState() =>
      _EnterpriseMeetingScreenOcrCardState();
}

class _EnterpriseMeetingScreenOcrCardState
    extends State<EnterpriseMeetingScreenOcrCard> {
  EnterpriseMobileScreenOcrView? _view;
  Timer? _timer;
  String _targetLanguage = 'zh';
  String _displayMode = 'bilingual';
  String? _errorCode;
  bool _busy = false;
  bool _polling = false;

  @override
  void initState() {
    super.initState();
    _targetLanguage = widget.defaultLanguage;
    _restart();
  }

  @override
  void didUpdateWidget(covariant EnterpriseMeetingScreenOcrCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final oldShare = oldWidget.share;
    final share = widget.share;
    if (oldWidget.meetingId != widget.meetingId ||
        oldWidget.workspace.context.tenant.id !=
            widget.workspace.context.tenant.id ||
        oldShare?.id != share?.id ||
        oldShare?.generation != share?.generation) {
      _restart();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final share = widget.share;
    if (share == null || share.status != 'active') {
      return const SizedBox.shrink();
    }
    final run = _view?.run;
    final enabled = _view?.subscription?.enabled == true;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(children: <Widget>[
              Icon(
                Icons.translate,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('共享内容翻译'),
                    Text(
                      '主动开启后低频识别变化区域；默认不保存屏幕帧。',
                      style: TextStyle(fontSize: 12),
                    ),
                  ],
                ),
              ),
              Chip(label: Text(_statusLabel(run?.status ?? 'off'))),
            ]),
            const SizedBox(height: 14),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                DropdownButton<String>(
                  value: _targetLanguage,
                  onChanged: _busy
                      ? null
                      : (value) => setState(() => _targetLanguage = value!),
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem(value: 'zh', child: Text('译为中文')),
                    DropdownMenuItem(
                        value: 'en', child: Text('Translate to English')),
                  ],
                ),
                DropdownButton<String>(
                  value: _displayMode,
                  onChanged: _busy
                      ? null
                      : (value) => setState(() => _displayMode = value!),
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem(value: 'original', child: Text('原图')),
                    DropdownMenuItem(value: 'translated', child: Text('译图')),
                    DropdownMenuItem(value: 'bilingual', child: Text('双语对照')),
                  ],
                ),
                FilledButton.icon(
                  onPressed: _busy ? null : _enable,
                  icon: const Icon(Icons.translate),
                  label: Text(enabled ? '应用设置' : '开启内容翻译'),
                ),
                if (enabled)
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _disable,
                    icon: const Icon(Icons.visibility_off_outlined),
                    label: const Text('关闭'),
                  ),
              ],
            ),
            if (run?.status == 'not_configured' ||
                run?.status == 'failed' ||
                run?.status == 'pending' ||
                _errorCode != null) ...<Widget>[
              const SizedBox(height: 12),
              Text(
                _notice(run?.status, run?.reasonCode, _errorCode),
                style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
    );
  }

  void _restart() {
    _timer?.cancel();
    _view = null;
    _errorCode = null;
    if (widget.share?.status != 'active') return;
    unawaited(_load());
    _timer = Timer.periodic(const Duration(seconds: 4), (_) => _load());
  }

  Future<void> _load() async {
    if (_polling) return;
    final expectedShareId = widget.share?.id;
    final expectedGeneration = widget.share?.generation;
    _polling = true;
    try {
      final next = await widget.client.currentMeetingScreenOcr(
        widget.workspace,
        widget.meetingId,
      );
      if (!mounted ||
          widget.share?.id != expectedShareId ||
          widget.share?.generation != expectedGeneration) {
        return;
      }
      final share = widget.share;
      final scoped = next.run != null &&
              share != null &&
              next.run!.shareId == share.id &&
              next.run!.shareGeneration == share.generation
          ? next
          : null;
      setState(() {
        _view = scoped;
        _errorCode = null;
        if (scoped?.subscription case final subscription?) {
          _targetLanguage = subscription.targetLanguage;
          _displayMode = subscription.displayMode;
        }
      });
      widget.onView(scoped);
    } catch (error) {
      if (mounted) setState(() => _errorCode = _code(error));
    } finally {
      _polling = false;
    }
  }

  Future<void> _enable() async {
    final share = widget.share;
    if (share == null) return;
    setState(() {
      _busy = true;
      _errorCode = null;
    });
    try {
      final next = await widget.client.enableMeetingScreenOcr(
        widget.workspace,
        widget.meetingId,
        shareId: share.id,
        expectedShareVersion: share.version,
        targetLanguage: _targetLanguage,
        displayMode: _displayMode,
        idempotencyKey: _uuid(),
      );
      if (!mounted ||
          widget.share?.id != share.id ||
          widget.share?.generation != share.generation) {
        return;
      }
      setState(() => _view = next);
      widget.onView(next);
    } catch (error) {
      if (mounted) setState(() => _errorCode = _code(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _disable() async {
    final subscription = _view?.subscription;
    final expectedShareId = widget.share?.id;
    final expectedGeneration = widget.share?.generation;
    if (subscription == null) return;
    setState(() {
      _busy = true;
      _errorCode = null;
    });
    try {
      final next = await widget.client.disableMeetingScreenOcr(
        widget.workspace,
        widget.meetingId,
        expectedVersion: subscription.version,
        idempotencyKey: _uuid(),
      );
      if (!mounted ||
          widget.share?.id != expectedShareId ||
          widget.share?.generation != expectedGeneration) {
        return;
      }
      setState(() => _view = next);
      widget.onView(next);
    } catch (error) {
      if (mounted) setState(() => _errorCode = _code(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

String _statusLabel(String value) => switch (value) {
      'pending' => '正在启动',
      'active' => '翻译中',
      'not_configured' => '未配置',
      'failed' => '已降级',
      'ended' => '已关闭',
      _ => '未开启',
    };

String _notice(String? status, String? reason, String? error) {
  if (status == 'pending') return 'OCR Worker 正在等待授权轨道；就绪前只显示原共享画面。';
  final label = <String, String>{
        'screen_ocr_provider_not_configured': '当前环境未配置 OCR Provider。',
        'screen_ocr_provider_configuration_invalid': 'OCR Provider 配置无效。',
        'screen_ocr_dispatch_not_enabled': 'OCR Worker 调度尚未启用。',
        'screen_ocr_signing_not_configured': 'OCR Worker 签名配置尚未就绪。',
        'meeting_rtc_not_configured': '会议媒体服务尚未就绪。',
        'screen_ocr_provider_timeout': 'OCR Provider 响应超时。',
        'screen_ocr_provider_rate_limited': 'OCR Provider 当前限流。',
        'screen_ocr_provider_unavailable': 'OCR Provider 当前不可达。',
        'screen_ocr_provider_protocol_invalid': 'OCR Provider 返回格式无效。',
        'screen_ocr_provider_failed': 'OCR Provider 处理失败。',
        'screen_ocr_track_unavailable': '授权的共享轨道不可用。',
        'screen_ocr_worker_fence_lost': 'OCR Worker 授权已失效。',
        'screen_ocr_worker_failed': 'OCR Worker 已停止。',
        'screen_ocr_request_failed': '共享内容翻译请求失败。',
      }[error ?? reason] ??
      '共享内容翻译当前不可用。';
  return '$label 原共享画面和会议字幕继续可用。';
}

String _code(Object error) => error is EnterpriseMobileApiException
    ? error.code
    : 'screen_ocr_request_failed';

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
