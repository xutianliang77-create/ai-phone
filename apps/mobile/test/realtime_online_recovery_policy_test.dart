import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_gateway_diagnostic.dart';
import 'package:translation_mobile/src/features/realtime/presentation/realtime_online_recovery_policy.dart';

void main() {
  const diagnostic = RealtimeGatewayDiagnostic(
    type: 'translation.failed',
    displayMessage: '翻译暂不可用',
    stage: 'translation',
    provider: 'hymt2_self_hosted',
    retryable: true,
  );

  test('shows recovery for online retryable diagnostics while active', () {
    for (final status in <RealtimeStatus>[
      RealtimeStatus.listening,
      RealtimeStatus.paused,
      RealtimeStatus.ended,
    ]) {
      expect(
        shouldShowOnlineRecovery(
          processingMode: RealtimeProcessingMode.online,
          status: status,
          diagnostic: diagnostic,
        ),
        isTrue,
      );
    }
  });

  test('hides recovery outside online diagnostic states', () {
    expect(
      shouldShowOnlineRecovery(
        processingMode: RealtimeProcessingMode.onDevice,
        status: RealtimeStatus.listening,
        diagnostic: diagnostic,
      ),
      isFalse,
    );
    expect(
      shouldShowOnlineRecovery(
        processingMode: RealtimeProcessingMode.online,
        status: RealtimeStatus.listening,
        diagnostic: null,
      ),
      isFalse,
    );
    expect(
      shouldShowOnlineRecovery(
        processingMode: RealtimeProcessingMode.online,
        status: RealtimeStatus.connecting,
        diagnostic: diagnostic,
      ),
      isFalse,
    );
  });
}
