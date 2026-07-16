import 'dart:async';

import '../data/voice_identity_api_client.dart';

String voiceIdentityOperationErrorMessage(Object error) {
  if (error is TimeoutException) {
    return '连接服务器超时，请检查网络后重试';
  }
  if (error is! VoiceIdentityApiException) {
    return '操作失败，请稍后重试';
  }
  if (error.statusCode == 401) {
    return '登录状态已失效，请重新登录后重试';
  }
  final code = _qualityIssue(error.body) ?? _errorCode(error.body);
  return switch (code) {
    'voice_reference_too_short' => '录音时间太短，请自然说话 5 至 15 秒后再停止',
    'voice_reference_too_long' => '录音时间太长，请控制在 5 至 15 秒内',
    'voice_reference_too_quiet' => '录音音量太低，请靠近麦克风并正常说话',
    'voice_reference_too_loud' => '录音音量过大，请离麦克风稍远后重试',
    'voice_reference_clipping' => '录音出现爆音，请降低音量并重新录制',
    'voice_reference_too_silent' => '有效语音太少，请连续自然说话后重试',
    'voice_reference_dc_offset' => '录音信号异常，请切换安静环境后重试',
    'voice_identity_provider_unavailable' => '声纹服务暂不可用，请稍后重试',
    _ => '操作失败，请稍后重试',
  };
}

String? _qualityIssue(Map<String, Object?> body) {
  final quality = body['quality'];
  if (quality is! Map) return null;
  final issues = quality['issues'];
  if (issues is! List || issues.isEmpty) return null;
  final first = issues.first;
  return first is String && first.isNotEmpty ? first : null;
}

String? _errorCode(Map<String, Object?> body) {
  final error = body['error'];
  if (error is! Map) return null;
  final code = error['code'];
  return code is String && code.isNotEmpty ? code : null;
}
