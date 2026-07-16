import 'dart:async';

import 'asr_text_segment.dart';

abstract class MobileAsrProvider {
  Stream<AsrTextSegment> get segments;

  Future<void> requestPermission();

  Future<void> start(MobileAsrConfig config);

  Future<void> stop();

  Future<void> dispose();
}

abstract class MobileAsrDiagnostics {
  Future<MobileAsrAvailability> availability(MobileAsrConfig config);
}

abstract class MobileAsrPreparation {
  Future<void> prepare(MobileAsrConfig config);
}

abstract class MobileAsrModelInspector {
  Future<Map<String, Object?>> inspectModel();
}

abstract class MobileAsrRuntimeInspector {
  Future<Map<String, Object?>> nativeAvailability();
}

abstract class MobileAsrDiagnosticTimeline {
  Future<void> recordDiagnosticEvent(
    String type, {
    Map<String, Object?> payload = const <String, Object?>{},
  });
}

class MobileAsrConfig {
  const MobileAsrConfig({
    required this.language,
    this.chunkDurationMs = 320,
    this.modelChunkMs = 2240,
    this.autoDownloadModel = false,
    this.endpointMinSpeechMs = 600,
    this.endpointSilenceMs = 900,
    this.endpointSpeechThresholdRms = 0.006,
    this.vadProvider = 'fluidaudio_silero',
    this.vadThreshold = 0.6,
    this.vadNegativeThreshold = 0.35,
    this.vadPreRollMs = 800,
    this.turnRoutingPolicy = 'alternate',
    this.diagnosticCaptureEnabled = false,
    this.diagnosticSessionId,
  });

  final String language;
  final int chunkDurationMs;
  final int modelChunkMs;
  final bool autoDownloadModel;
  final int endpointMinSpeechMs;
  final int endpointSilenceMs;
  final double endpointSpeechThresholdRms;
  final String vadProvider;
  final double vadThreshold;
  final double vadNegativeThreshold;
  final int vadPreRollMs;
  final String turnRoutingPolicy;
  final bool diagnosticCaptureEnabled;
  final String? diagnosticSessionId;
}

class MobileAsrAvailability {
  const MobileAsrAvailability({
    required this.canStart,
    required this.reason,
    required this.message,
    this.details = const <String, Object?>{},
  });

  final bool canStart;
  final String reason;
  final String message;
  final Map<String, Object?> details;
}
