import 'package:flutter/material.dart';

import '../../../call_link/data/call_link_api_client.dart';
import '../../../call_link/data/call_room_client.dart';
import '../../data/pstn_call_readiness_client.dart';
import '../pstn_call_error_message.dart';

export 'pstn_call_language_field.dart';

class PstnCallAvailabilityCard extends StatelessWidget {
  const PstnCallAvailabilityCard({
    required this.policyEnabled,
    required this.loading,
    required this.readiness,
    required this.error,
    required this.chinese,
    required this.onRetry,
    super.key,
  });

  final bool policyEnabled;
  final bool loading;
  final PstnCallReadiness? readiness;
  final Object? error;
  final bool chinese;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final ready = readiness?.isReady == true;
    final theme = Theme.of(context);
    return Card(
      color: ready
          ? theme.colorScheme.primaryContainer
          : theme.colorScheme.surfaceContainerHigh,
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(ready
                    ? Icons.check_circle_outline
                    : Icons.science_outlined),
                const SizedBox(width: 10),
                Expanded(
                  child:
                      Text(_title(ready), style: theme.textTheme.titleMedium),
                ),
                if (loading)
                  const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(_body(ready)),
            if (policyEnabled &&
                !loading &&
                (error != null || !ready)) ...<Widget>[
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: Text(_text('重新检查', 'Check again')),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _title(bool ready) {
    if (!policyEnabled) return _text('P2 灰度功能', 'P2 preview');
    if (loading) return _text('正在检查拨号服务', 'Checking calling service');
    return ready
        ? _text('PSTN 链路已就绪', 'PSTN service ready')
        : _text('拨号服务未就绪', 'Calling service unavailable');
  }

  String _body(bool ready) {
    if (!policyEnabled) {
      return _text(
        '当前版本使用 Call Link；直拨入口保留，不会发起真实外呼。',
        'This build uses Call Link. Direct dialing remains visible but cannot place a real call.',
      );
    }
    if (error != null) {
      return _text(
        '无法连接 API 检查服务状态。',
        'Could not reach the API to check service status.',
      );
    }
    return ready
        ? _text(
            '服务商和合规配置已通过，确认信息后可开始拨打。',
            'Provider and compliance checks passed. Review the details to start calling.',
          )
        : _text(
            '可先完成号码、语言和告知检查，待服务商接入后开放外呼。',
            'Review the number, languages, and disclosure now. Calling opens after provider integration.',
          );
  }

  String _text(String zh, String en) => chinese ? zh : en;
}

class PstnCallReviewCard extends StatelessWidget {
  const PstnCallReviewCard({
    required this.phone,
    required this.hostLanguage,
    required this.calleeLanguage,
    required this.canDial,
    required this.chinese,
    required this.busy,
    required this.onDial,
    super.key,
  });

  final String phone;
  final String hostLanguage;
  final String calleeLanguage;
  final bool canDial;
  final bool chinese;
  final bool busy;
  final VoidCallback? onDial;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              _text('拨号信息已确认', 'Call details reviewed'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            Text('$phone  ·  $hostLanguage → $calleeLanguage'),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: canDial && !busy ? onDial : null,
                icon: const Icon(Icons.phone_forwarded_outlined),
                label: Text(busy
                    ? _text('正在建立安全通话', 'Starting secure call')
                    : canDial
                        ? _text(
                            '开始拨打',
                            'Start call',
                          )
                        : _text(
                            '当前不发起真实外呼',
                            'Real calling is not enabled',
                          )),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _text(String zh, String en) => chinese ? zh : en;
}

class PstnActiveCallCard extends StatelessWidget {
  const PstnActiveCallCard({
    required this.call,
    required this.roomSnapshot,
    required this.busy,
    required this.hangupPending,
    required this.chinese,
    required this.onEnd,
    required this.onDtmf,
    required this.onTransfer,
    this.supportsDtmf = true,
    this.supportsTransfer = true,
    this.endResult,
    this.error,
    super.key,
  });

  final SipOutboundCall call;
  final CallRoomSnapshot roomSnapshot;
  final bool busy;
  final bool hangupPending;
  final bool chinese;
  final VoidCallback onEnd;
  final ValueChanged<String> onDtmf;
  final VoidCallback onTransfer;
  final bool supportsDtmf;
  final bool supportsTransfer;
  final CallLinkEndResult? endResult;
  final Object? error;

  @override
  Widget build(BuildContext context) {
    final isAir780 = call.provider == 'air780_volte';
    final connected = isAir780
        ? call.carrierState == 'connected'
        : call.status == 'active';
    final status = _status(isAir780: isAir780, connected: connected);
    return Card(
      margin: const EdgeInsets.only(top: 16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(status, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(_text(
              '房间、字幕、译音和计费已绑定到本次通话。',
              'The room, captions, translated audio, and billing are bound to this call.',
            )),
            if (error != null) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                pstnCallErrorMessage(error!, chinese: chinese),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            if (endResult == null) ...<Widget>[
              if (supportsDtmf) ...<Widget>[
                const SizedBox(height: 12),
                Text(
                  _text('拨号键盘', 'Keypad'),
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                const SizedBox(height: 8),
                GridView.count(
                  crossAxisCount: 3,
                  mainAxisSpacing: 8,
                  crossAxisSpacing: 8,
                  childAspectRatio: 2.1,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  children: '123456789*0#'.split('').map((digit) {
                    return OutlinedButton(
                      onPressed:
                          busy || !connected ? null : () => onDtmf(digit),
                      child: Text(digit),
                    );
                  }).toList(growable: false),
                ),
                if (supportsTransfer) ...<Widget>[
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: TextButton.icon(
                      onPressed: busy || !connected ? null : onTransfer,
                      icon: const Icon(Icons.phone_forwarded_outlined),
                      label: Text(_text('转接电话', 'Transfer call')),
                    ),
                  ),
                ],
              ],
              const SizedBox(height: 4),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: busy || hangupPending ? null : onEnd,
                  icon: const Icon(Icons.call_end_outlined),
                  label: Text(hangupPending
                      ? _text('正在确认挂断', 'Confirming hangup')
                      : _text('结束通话', 'End call')),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _status({required bool isAir780, required bool connected}) {
    if (endResult != null) return _text('通话已结束', 'Call ended');
    if (hangupPending) {
      return _text('正在等待电话线路结束', 'Waiting for carrier hangup');
    }
    if (!isAir780) {
      return connected
          ? _text('电话已接通', 'Phone connected')
          : _text('正在等待对方接听', 'Waiting for answer');
    }
    switch (call.carrierState) {
      case 'connected':
        return _text('电话已接通', 'Phone connected');
      case 'ringing':
        return _text('对方电话振铃中', 'Phone is ringing');
      case 'dialing':
        return _text('正在拨号', 'Dialing');
      case 'busy':
        return _text('对方忙线', 'Line is busy');
      case 'failed':
        return _text('电话连接失败', 'Call failed');
      case 'disconnected':
        return _text('通话已结束', 'Call ended');
      case 'unknown':
        return _text('拨号结果对账中', 'Reconciling dial result');
      default:
        return call.status == 'unknown'
            ? _text('拨号结果对账中', 'Reconciling dial result')
            : _text('正在与运营商确认电话状态', 'Confirming carrier status');
    }
  }

  String _text(String zh, String en) => chinese ? zh : en;
}
