import 'package:flutter_test/flutter_test.dart';

import 'package:translation_mobile/src/features/device_asr/data/core_ml_nemotron_audio_diagnostic.dart';

void main() {
  test('reports audio session error before microphone input issue', () {
    final diagnostic = coreMlNemotronAudioDiagnostic(const <String, Object?>{
      'fluidAudio': <String, Object?>{
        'audio': <String, Object?>{
          'sessionActive': false,
          'sessionError': 'AVAudioSession activation failed',
          'inputBuffers': 0,
          'convertedSamples': 0,
          'emittedChunks': 0,
        },
      },
    });

    expect(diagnostic?.status, 'warning');
    expect(diagnostic?.issue, 'audio_session_error');
  });

  test('reports no microphone input issue', () {
    final diagnostic = coreMlNemotronAudioDiagnostic(const <String, Object?>{
      'fluidAudio': <String, Object?>{
        'audio': <String, Object?>{
          'inputBuffers': 0,
          'convertedSamples': 0,
          'emittedChunks': 0,
        },
      },
    });

    expect(diagnostic?.status, 'warning');
    expect(diagnostic?.issue, 'no_microphone_input');
  });

  test('reports voice processing activation failure before microphone input',
      () {
    final diagnostic = coreMlNemotronAudioDiagnostic(const <String, Object?>{
      'fluidAudio': <String, Object?>{
        'audio': <String, Object?>{
          'voiceProcessingAttempted': true,
          'lastVoiceProcessingEnabled': false,
          'voiceProcessingError': 'Voice processing did not become active',
          'inputBuffers': 0,
          'convertedSamples': 0,
          'emittedChunks': 0,
        },
      },
    });

    expect(diagnostic?.status, 'warning');
    expect(diagnostic?.issue, 'voice_processing_error');
  });

  test('reports ASR processing error before missing ASR chunks', () {
    final diagnostic = coreMlNemotronAudioDiagnostic(const <String, Object?>{
      'fluidAudio': <String, Object?>{
        'processingError': 'FluidAudio process failed',
        'audio': <String, Object?>{
          'inputBuffers': 3,
          'convertedSamples': 22400,
          'emittedChunks': 0,
        },
      },
    });

    expect(diagnostic?.status, 'warning');
    expect(diagnostic?.issue, 'asr_processing_error');
    expect(diagnostic?.audio['processingError'], 'FluidAudio process failed');
  });

  test('reports explicit RMS fallback when FluidAudio VAD is unavailable', () {
    final diagnostic = coreMlNemotronAudioDiagnostic(const <String, Object?>{
      'fluidAudio': <String, Object?>{
        'vad': <String, Object?>{
          'configuredProvider': 'fluidaudio_silero',
          'activeProvider': 'rms_fallback',
          'fallbackReason': 'model unavailable',
          'fallbackCount': 1,
        },
        'audio': <String, Object?>{
          'inputBuffers': 3,
          'convertedSamples': 22400,
          'emittedChunks': 2,
        },
      },
    });

    expect(diagnostic?.status, 'warning');
    expect(diagnostic?.issue, 'vad_fallback');
    expect(diagnostic?.audio['vadFallbackReason'], 'model unavailable');
  });

  test('reports audio session error before ASR processing error', () {
    final diagnostic = coreMlNemotronAudioDiagnostic(const <String, Object?>{
      'fluidAudio': <String, Object?>{
        'processingError': 'FluidAudio process failed',
        'audio': <String, Object?>{
          'sessionError': 'AVAudioSession activation failed',
          'voiceProcessingAttempted': true,
          'lastVoiceProcessingEnabled': false,
          'voiceProcessingError': 'Voice processing failed',
          'inputBuffers': 0,
        },
      },
    });

    expect(diagnostic?.issue, 'audio_session_error');
  });

  test('reports no converted samples issue', () {
    final diagnostic = coreMlNemotronAudioDiagnostic(const <String, Object?>{
      'audio': <String, Object?>{
        'inputBuffers': 2,
        'convertedSamples': 0,
        'emittedChunks': 0,
      },
    });

    expect(diagnostic?.status, 'warning');
    expect(diagnostic?.issue, 'no_converted_samples');
  });

  test('reports audio conversion failure issue', () {
    final diagnostic = coreMlNemotronAudioDiagnostic(const <String, Object?>{
      'audio': <String, Object?>{
        'inputBuffers': 2,
        'convertedSamples': 0,
        'conversionFailures': 1,
        'floatExtractionFailures': 0,
        'lastConversionError': 'converter_unavailable',
      },
    });

    expect(diagnostic?.status, 'warning');
    expect(diagnostic?.issue, 'audio_conversion_failed');
  });

  test('reports ok when ASR chunks are emitted', () {
    final diagnostic = coreMlNemotronAudioDiagnostic(const <String, Object?>{
      'fluidAudio': <String, Object?>{
        'audio': <String, Object?>{
          'inputBuffers': 3,
          'convertedSamples': 67200,
          'emittedChunks': 2,
        },
      },
    });

    expect(diagnostic?.toJson(), <String, Object?>{
      'status': 'ok',
      'issue': null,
      'audio': <String, Object?>{
        'inputBuffers': 3,
        'convertedSamples': 67200,
        'emittedChunks': 2,
      },
    });
  });
}
