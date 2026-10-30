import 'package:http/http.dart' as http;

/// Transport facts only. Never includes a URL, body, header or error message.
class NativeHttpObservation {
  const NativeHttpObservation(
    this.phase, {
    this.errorCode,
    this.errorDomain,
    this.metrics,
  });
  final String phase;
  final int? errorCode;
  final String? errorDomain;
  final List<Map<String, Object?>>? metrics;
}

class ObservedHttpRequest extends http.Request implements http.Abortable {
  ObservedHttpRequest(
    super.method,
    super.url, {
    this.abortTrigger,
    required this.onNativeObservation,
  });
  @override
  final Future<void>? abortTrigger;
  final void Function(NativeHttpObservation) onNativeObservation;

  void observeNative(
    String phase, {
    int? errorCode,
    String? errorDomain,
    List<Map<String, Object?>>? metrics,
  }) {
    try {
      onNativeObservation(
        NativeHttpObservation(
          phase,
          errorCode: errorCode,
          errorDomain: errorDomain,
          metrics: metrics,
        ),
      );
    } catch (_) {
      // Diagnostics must not change transport or cancellation behavior.
    }
  }
}
