bool isValidAgentCallPhone(String value) {
  final phone = value.replaceAll(RegExp(r'[^\d+]'), '').replaceFirst('+86', '');
  return RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(phone) ||
      RegExp(r'^1[3-9]\d{9}$').hasMatch(phone) ||
      RegExp(r'^0\d{9,11}$').hasMatch(phone) ||
      RegExp(r'^(10|95|96)\d{3,4}$').hasMatch(phone);
}

String agentCallErrorMessage(Object error) {
  final message = error.toString();
  if (message.contains('Create agent draft failed')) {
    return '创建任务失败，请检查 API 服务。';
  }
  if (message.contains('Authorize agent draft failed')) return '授权失败，请稍后重试。';
  if (message.contains('Start agent call failed')) return '拨号执行服务未配置，暂不外呼。';
  if (message.contains('Get agent draft failed')) return '刷新状态失败，请稍后重试。';
  if (message.contains('Request takeover failed')) return '接管请求失败，请稍后重试。';
  if (message.contains('Cancel agent draft failed')) return '取消任务失败，请稍后重试。';
  return message.replaceFirst('Exception: ', '');
}
