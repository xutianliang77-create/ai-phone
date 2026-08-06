import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/data/ai_calling_agent_api_client.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/presentation/ai_calling_agent_policy.dart';

void main() {
  test('distinguishes rate limiting from missing execution configuration', () {
    expect(
      agentCallErrorMessage(const AiCallingAgentApiException(
        'Start agent call failed',
        statusCode: 429,
        code: 'agent_call_rate_limited',
      )),
      '每小时 AI 外呼次数已达上限，请稍后重试。',
    );
    expect(
      agentCallErrorMessage(const AiCallingAgentApiException(
        'Start agent call failed',
        statusCode: 503,
        code: 'agent_call_execution_not_ready',
      )),
      '拨号执行服务未配置，暂不外呼。',
    );
  });
}
