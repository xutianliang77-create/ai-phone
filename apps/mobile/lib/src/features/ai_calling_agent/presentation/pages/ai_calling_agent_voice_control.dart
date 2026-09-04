part of 'ai_calling_agent_page.dart';

extension _AiCallingAgentVoiceControl on _AiCallingAgentPageState {
  Widget _buildVoiceControlPanel() {
    final state = _voiceControlSnapshot;
    final permission = state.permissions.isEmpty ? null : state.permissions.first;
    final owns = state.ownership != null && !state.ownedByAnotherClient;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              owns ? '本机已控制后台播报' : '后台播报控制权未就绪',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            if (state.message != null) ...[
              const SizedBox(height: 4),
              Text(state.message!),
            ],
            if (state.error != null) ...[
              const SizedBox(height: 4),
              Text(
                '后台控制暂不可用：${state.error}',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            if (state.ownedByAnotherClient) ...[
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: _loading ? null : _takeOverVoiceControl,
                child: const Text('将后台播报控制权切换到本机'),
              ),
            ],
            if (permission != null) ...[
              const Divider(height: 24),
              Text('AI 请求执行：${permission.toolName}'),
              const SizedBox(height: 4),
              Text(
                '风险：${permission.riskLevel} · '
                '范围：${permission.sideEffectScopes.join('、')}',
              ),
              const SizedBox(height: 8),
              Row(
                children: <Widget>[
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _loading
                          ? null
                          : () => _resolveVoicePermission(permission, 'deny'),
                      child: const Text('拒绝'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton(
                      onPressed: _loading
                          ? null
                          : () => _resolveVoicePermission(permission, 'grant'),
                      child: const Text('允许本次执行'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _takeOverVoiceControl() async {
    await _run(() async {
      await _voiceControl?.takeOverOwnership();
      _notice = '本机已申请接管后台播报控制。';
    });
  }

  Future<void> _resolveVoicePermission(
    AgentWorkPermissionRequest permission,
    String decision,
  ) async {
    await _run(() async {
      await _voiceControl?.resolvePermission(permission, decision);
      _notice = decision == 'grant' ? '已允许本次执行。' : '已拒绝本次执行。';
    });
  }
}
