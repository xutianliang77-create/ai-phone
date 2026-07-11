import '../../../../platform/asr/mobile_asr_provider.dart';
import '../../../device_asr/data/core_ml_nemotron_audio_diagnostic.dart';
import 'error_display_message.dart';

Future<String> deviceAsrFailureMessage(
  MobileAsrProvider? provider,
  Object error,
) async {
  final baseMessage = displayRealtimeErrorMessage(error);
  final inspector = provider is MobileAsrRuntimeInspector
      ? provider as MobileAsrRuntimeInspector
      : null;
  if (inspector == null) return baseMessage;
  try {
    final diagnostic =
        coreMlNemotronAudioDiagnostic(await inspector.nativeAvailability());
    final issue = diagnostic?.issue;
    if (issue == null || issue == 'ok') return baseMessage;
    final processingError = diagnostic?.audio['processingError'];
    if (issue == 'asr_processing_error' && processingError is String) {
      return '$baseMessage; Device ASR processing failed: '
          '${processingError.trim()}';
    }
    return '$baseMessage; Device ASR diagnostic: $issue';
  } catch (_) {
    return baseMessage;
  }
}
