import '../../data/gateway/gateway_realtime_event.dart';

class RealtimeGatewayDiagnostic {
  const RealtimeGatewayDiagnostic({
    required this.type,
    required this.displayMessage,
    this.code,
    this.stage,
    this.provider,
    this.retryable,
    this.message,
    this.segmentId,
    this.revision,
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
      message: event.message,
      segmentId: event.segmentId,
      revision: event.revision,
    );
  }

  final String type;
  final String displayMessage;
  final String? code;
  final String? stage;
  final String? provider;
  final bool? retryable;
  final String? message;
  final String? segmentId;
  final int? revision;

  bool get isRetryable => retryable == true;
}
