import '../../data/gateway/gateway_realtime_event.dart';

class RealtimeGatewayDiagnostic {
  const RealtimeGatewayDiagnostic({
    required this.type,
    required this.displayMessage,
    this.code,
    this.stage,
    this.provider,
    this.retryable,
  });

  factory RealtimeGatewayDiagnostic.fromEvent(
    GatewayRealtimeEvent event, {
    required String displayMessage,
  }) {
    return RealtimeGatewayDiagnostic(
      type: event.type,
      displayMessage: displayMessage,
      code: event.code,
      stage: event.stage,
      provider: event.provider,
      retryable: event.retryable,
    );
  }

  final String type;
  final String displayMessage;
  final String? code;
  final String? stage;
  final String? provider;
  final bool? retryable;

  bool get isRetryable => retryable == true;
}
