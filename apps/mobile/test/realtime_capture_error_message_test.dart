import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/error_display_message.dart';
void main() {
  test('capture startup and configuration failures explain the microphone problem', () {
    for (final code in ['public_capture_first_pcm_timeout','audio_configuration_unstable','audio_capture_resume_unconfirmed']) {
      expect(displayRealtimeErrorMessage(StateError(code)),contains('麦克风音频路由'));
    }
    expect(displayRealtimeErrorMessage(StateError('qwen_audio_task_failed')),contains('qwen_audio_task_failed'));
  });
}
