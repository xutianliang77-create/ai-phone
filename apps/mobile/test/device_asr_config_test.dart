import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_runtime_factories.dart';

void main() {
  test('uses alternate turn routing for conversation mode', () {
    final config = _config(realtimeMode: 'conversation');

    final asr = createDeviceAsrConfig(
      config,
      diagnosticSessionId: 'session-1',
    );

    expect(asr.endpointMinSpeechMs, 600);
    expect(asr.vadProvider, 'fluidaudio_silero');
    expect(asr.vadThreshold, 0.6);
    expect(asr.vadNegativeThreshold, 0.35);
    expect(asr.vadPreRollMs, 800);
    expect(asr.turnRoutingPolicy, 'alternate');
    expect(asr.diagnosticSessionId, 'session-1');
  });

  test('uses sticky turn routing for listening mode', () {
    final asr = createDeviceAsrConfig(_config(realtimeMode: 'meeting'));

    expect(asr.turnRoutingPolicy, 'sticky');
  });
}

AppConfig _config({required String realtimeMode}) {
  return AppConfig(
    apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
    useMockAudio: false,
    useDeviceAsr: true,
    realtimeMode: realtimeMode,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'turn',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: true,
  );
}
