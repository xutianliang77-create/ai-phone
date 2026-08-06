import '../data/ai_calling_agent_api_client.dart';

bool isValidAgentCallPhone(String value) {
  final phone = value.replaceAll(RegExp(r'[^\d+]'), '').replaceFirst('+86', '');
  return RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(phone) ||
      RegExp(r'^1[3-9]\d{9}$').hasMatch(phone) ||
      RegExp(r'^0\d{9,11}$').hasMatch(phone) ||
      RegExp(r'^(10|95|96)\d{3,4}$').hasMatch(phone);
}

String agentCallErrorMessage(Object error) {
  if (error is AiCallingAgentApiException) {
    switch (error.code) {
      case 'agent_call_rate_limited':
        return '每小时 AI 外呼次数已达上限，请稍后重试。';
      case 'agent_call_execution_not_ready':
        return '拨号执行服务未配置，暂不外呼。';
      case 'agent_call_insufficient_balance':
        return 'AI 外呼用量余额不足，请先充值或更换套餐。';
      case 'agent_call_target_required':
        return '请先填写有效电话号码。';
      case 'agent_call_cannot_cancel':
        return '当前任务状态无法取消。';
    }
  }
  final message = error.toString();
  if (message.contains('Create agent draft failed')) {
    return '创建任务失败，请检查 API 服务。';
  }
  if (message.contains('Authorize agent draft failed')) return '授权失败，请稍后重试。';
  if (message.contains('Start agent call failed')) return '拨号失败，请刷新状态后重试。';
  if (message.contains('Get agent draft failed')) return '刷新状态失败，请稍后重试。';
  if (message.contains('Request takeover failed')) return '接管请求失败，请稍后重试。';
  if (message.contains('Cancel agent draft failed')) return '取消任务失败，请稍后重试。';
  return message.replaceFirst('Exception: ', '');
}
