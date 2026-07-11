import 'package:flutter_test/flutter_test.dart';

import '../integration_test/core_ml_nemotron_model_scan_log.dart';

void main() {
  test('reports audio session error before microphone counters', () {
    final issue = coreMlNemotronAudioCaptureIssue(const <String, Object?>{
      'fluidAudio': <String, Object?>{
        'audio': <String, Object?>{
          'sessionError': 'AVAudioSession activation failed',
          'inputBuffers': 0,
          'convertedSamples': 0,
          'emittedChunks': 0,
        },
      },
    });

    expect(issue, contains('Device ASR audio session failed'));
    expect(
        issue, contains('audio.sessionError=AVAudioSession activation failed'));
    expect(issue, isNot(contains('did not receive microphone audio')));
  });

  test('reports missing microphone audio when no session error exists', () {
    final issue = coreMlNemotronAudioCaptureIssue(const <String, Object?>{
      'fluidAudio': <String, Object?>{
        'audio': <String, Object?>{
          'inputBuffers': 0,
          'convertedSamples': 0,
          'emittedChunks': 0,
        },
      },
    });

    expect(issue, contains('Device ASR did not receive microphone audio'));
    expect(issue, contains('audio.inputBuffers=0'));
    expect(issue, contains('audio.convertedSamples=0'));
    expect(issue, contains('audio.emittedChunks=0'));
  });

  test('reports processing error before microphone counters', () {
    final issue = coreMlNemotronAudioCaptureIssue(const <String, Object?>{
      'fluidAudio': <String, Object?>{
        'processingError': 'FluidAudio process failed',
        'audio': <String, Object?>{
          'inputBuffers': 3,
          'convertedSamples': 22400,
          'emittedChunks': 0,
        },
      },
    });

    expect(issue, contains('Device ASR processing failed'));
    expect(issue,
        contains('fluidAudio.processingError=FluidAudio process failed'));
    expect(issue, isNot(contains('did not receive microphone audio')));
  });
}
