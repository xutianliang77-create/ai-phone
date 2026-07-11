import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/device_asr_failure_message.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';

void main() {
  test('adds retained ASR processing error to device failure messages',
      () async {
    final message = await deviceAsrFailureMessage(
      _RuntimeInspectingAsrProvider(const <String, Object?>{
        'fluidAudio': <String, Object?>{
          'processingError': 'FluidAudio process failed',
          'audio': <String, Object?>{'inputBuffers': 3},
        },
      }),
      StateError('device ASR start failed'),
    );

    expect(message, contains('device ASR start failed'));
    expect(message, contains('Device ASR processing failed'));
    expect(message, contains('FluidAudio process failed'));
  });

  test('keeps base failure message when runtime diagnostics are unavailable',
      () async {
    final message = await deviceAsrFailureMessage(
      _BasicAsrProvider(),
      StateError('device ASR start failed'),
    );

    expect(message, 'Bad state: device ASR start failed');
  });
}

class _RuntimeInspectingAsrProvider extends _BasicAsrProvider
    implements MobileAsrRuntimeInspector {
  _RuntimeInspectingAsrProvider(this.payload);

  final Map<String, Object?> payload;

  @override
  Future<Map<String, Object?>> nativeAvailability() async => payload;
}

class _BasicAsrProvider implements MobileAsrProvider {
  final _segments = StreamController<AsrTextSegment>.broadcast();

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> start(MobileAsrConfig config) async {}

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() async {
    await _segments.close();
  }
}
