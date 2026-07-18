import 'package:flutter/material.dart';

import '../../../call_link/data/call_room_client.dart';
import '../../data/agent_consult_api_client.dart';

class AgentOperatorConsultView extends StatelessWidget {
  const AgentOperatorConsultView({
    required this.consult,
    required this.room,
    required this.phoneController,
    required this.busy,
    required this.mainConnected,
    required this.onStart,
    required this.onAccept,
    required this.onReject,
    required this.onComplete,
    required this.onReconnect,
    required this.onReturn,
    this.error,
    super.key,
  });

  final AgentConsult? consult;
  final CallRoomSnapshot room;
  final TextEditingController phoneController;
  final bool busy;
  final bool mainConnected;
  final VoidCallback onStart;
  final VoidCallback onAccept;
  final VoidCallback onReject;
  final VoidCallback onComplete;
  final VoidCallback onReconnect;
  final VoidCallback onReturn;
  final Object? error;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('咨询外部坐席')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Icon(
                consult?.status == 'merged'
                    ? Icons.groups
                    : Icons.support_agent,
                size: 56,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(height: 16),
              Text(
                statusText(consult),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              Text(
                '房间参与者：${room.remoteParticipantCount} · '
                '麦克风：${room.microphoneEnabled ? '已开启' : '未开启'}',
                textAlign: TextAlign.center,
              ),
              if (consult == null) ...[
                const SizedBox(height: 24),
                TextField(
                  controller: phoneController,
                  enabled: !busy,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(
                    labelText: '外部坐席手机号',
                    hintText: '+8613800000000',
                    helperText: '请输入带国家区号的 E.164 号码',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
              if (busy) ...[
                const SizedBox(height: 20),
                const LinearProgressIndicator(),
              ],
              if (error != null) ...[
                const SizedBox(height: 20),
                Text(
                  '操作失败：$error',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const Spacer(),
              ...actions(),
              const SizedBox(height: 8),
              const Text(
                '私密咨询期间原被叫方听不到外部坐席；接受后才进入三方通话。',
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> actions() {
    if (consult == null) {
      return [
        FilledButton.icon(
          onPressed: busy ? null : onStart,
          icon: const Icon(Icons.call),
          label: const Text('拨打并进入私密咨询'),
        ),
      ];
    }
    if (consult!.status == 'connected') {
      return [
        FilledButton.icon(
          onPressed: busy ? null : onAccept,
          icon: const Icon(Icons.group_add),
          label: const Text('接受坐席，加入原通话'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: busy ? null : onReject,
          child: const Text('拒绝并返回原通话'),
        ),
      ];
    }
    if (const {'requested', 'dialing'}.contains(consult!.status)) {
      return [
        OutlinedButton(
          onPressed: busy ? null : onReject,
          child: const Text('取消咨询并返回原通话'),
        ),
      ];
    }
    if (consult!.status == 'merged') {
      return [
        FilledButton.icon(
          onPressed: busy
              ? null
              : mainConnected
                  ? onComplete
                  : onReconnect,
          icon: Icon(mainConnected ? Icons.check_circle : Icons.refresh),
          label: Text(mainConnected ? '确认三方交接完成' : '重新进入原通话'),
        ),
      ];
    }
    return [
      FilledButton(
        onPressed: busy ? null : onReturn,
        child: const Text('返回人工接管'),
      ),
    ];
  }
}

String statusText(AgentConsult? consult) {
  return switch (consult?.status) {
    null => '输入外部坐席号码，先建立私密咨询',
    'requested' || 'dialing' => '正在呼叫外部坐席…',
    'connected' => '外部坐席已接通，当前仅你们两人可听见',
    'merging' => '正在将外部坐席加入原通话…',
    'merged' => '坐席已加入，请回到原通话完成三方确认',
    'completed' => '三方交接已完成',
    'rejected' => '已取消本次外部咨询',
    'no_answer' => '外部坐席未接听，已恢复原通话',
    'failed' => '外部咨询失败，已恢复原通话',
    _ => '正在同步咨询状态…',
  };
}
