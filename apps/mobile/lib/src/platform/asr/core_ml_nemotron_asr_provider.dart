import 'dart:async';

import 'package:flutter/services.dart';

import 'asr_text_segment.dart';
import 'mobile_asr_provider.dart';

class CoreMlNemotronAsrProvider
    implements
        MobileAsrProvider,
        MobileAsrDiagnostics,
        MobileAsrPreparation,
        MobileAsrModelInspector,
        MobileAsrRuntimeInspector,
        MobileAsrDiagnosticTimeline {
  CoreMlNemotronAsrProvider({
    MethodChannel? methodChannel,
    EventChannel? eventChannel,
  })  : _methodChannel = methodChannel ??
            const MethodChannel('translation_mobile/core_ml_nemotron_asr'),
        _eventChannel = eventChannel ??
            const EventChannel(
                'translation_mobile/core_ml_nemotron_asr/events');

  final MethodChannel _methodChannel;
  final EventChannel _eventChannel;
  Stream<AsrTextSegment>? _segments;

  @override
  Stream<AsrTextSegment> get segments {
    return _segments ??= _eventChannel
        .receiveBroadcastStream()
        .where((event) => event is Map)
        .map((event) {
          final payload = Map<String, Object?>.from(event as Map);
          if (payload['type'] == 'runtime.error') {
            throw PlatformException(
              code: payload['code'] as String? ?? 'device_asr_runtime_error',
              message:
                  payload['message'] as String? ?? 'Device ASR runtime failed',
              details: payload,
            );
          }
          return AsrTextSegment.tryFromJson(payload);
        })
        .where((segment) => segment != null)
        .cast<AsrTextSegment>();
  }

  @override
  Future<Map<String, Object?>> nativeAvailability() async {
    final result = await _methodChannel.invokeMapMethod<String, Object?>(
      'isAvailable',
    );
    return result ?? <String, Object?>{};
  }

  @override
  Future<MobileAsrAvailability> availability(MobileAsrConfig config) async {
    final payload = await nativeAvailability();
    final reason = payload['reason'] as String? ?? 'unknown';
    final runtimeReady =
        ((payload['fluidAudio'] as Map?)?['runtimeAvailable']) as bool? ??
            false;
    final localReady = payload['localModelReady'] as bool? ?? false;
    final preparedReady = payload['preparedModelReady'] as bool? ?? false;
    final microphonePermission =
        ((payload['microphone'] as Map?)?['permission']) as String?;
    final canDownload = config.autoDownloadModel &&
        runtimeReady &&
        (reason == 'model_not_found' || reason == 'model_incomplete');

    if (microphonePermission == 'denied') {
      return MobileAsrAvailability(
        canStart: false,
        reason: 'microphone_permission_denied',
        message: 'Microphone permission was denied',
        details: payload,
      );
    }
    if (runtimeReady && (localReady || preparedReady)) {
      return MobileAsrAvailability(
        canStart: true,
        reason: 'ready',
        message: 'Device ASR ready',
        details: payload,
      );
    }
    if (canDownload) {
      return MobileAsrAvailability(
        canStart: true,
        reason: reason,
        message: 'Device ASR will download Nemotron model on start',
        details: payload,
      );
    }
    return MobileAsrAvailability(
      canStart: false,
      reason: reason,
      message: _availabilityMessage(reason),
      details: payload,
    );
  }

  @override
  Future<Map<String, Object?>> inspectModel() async {
    final result = await _methodChannel.invokeMapMethod<String, Object?>(
      'inspectModel',
    );
    return result ?? <String, Object?>{};
  }

  @override
  Future<void> requestPermission() async {
    await _methodChannel.invokeMethod<void>('requestPermission');
  }

  @override
  Future<void> prepare(MobileAsrConfig config) async {
    await _methodChannel.invokeMethod<void>('prepare', _arguments(config));
  }

  @override
  Future<void> start(MobileAsrConfig config) async {
    await _methodChannel.invokeMethod<void>('start', _arguments(config));
  }

  Map<String, Object?> _arguments(MobileAsrConfig config) {
    return <String, Object?>{
      'language': config.language,
      'chunkDurationMs': config.chunkDurationMs,
      'modelChunkMs': config.modelChunkMs,
      'autoDownloadModel': config.autoDownloadModel,
      'endpointMinSpeechMs': config.endpointMinSpeechMs,
      'endpointSilenceMs': config.endpointSilenceMs,
      'endpointSpeechThresholdRms': config.endpointSpeechThresholdRms,
      'vadProvider': config.vadProvider,
      'vadThreshold': config.vadThreshold,
      'vadNegativeThreshold': config.vadNegativeThreshold,
      'vadPreRollMs': config.vadPreRollMs,
      'turnRoutingPolicy': config.turnRoutingPolicy,
      'diagnosticCaptureEnabled': config.diagnosticCaptureEnabled,
      'diagnosticSessionId': config.diagnosticSessionId,
    };
  }

  @override
  Future<void> stop() async {
    await _methodChannel.invokeMethod<void>('stop');
  }

  @override
  Future<void> recordDiagnosticEvent(
    String type, {
    Map<String, Object?> payload = const <String, Object?>{},
  }) async {
    await _methodChannel.invokeMethod<void>(
      'recordDiagnosticEvent',
      <String, Object?>{'type': type, 'payload': payload},
    );
  }

  @override
  Future<void> dispose() async {
    await stop();
  }

  String _availabilityMessage(String reason) {
    switch (reason) {
      case 'model_not_found':
        return 'Nemotron Core ML model was not found';
      case 'model_incomplete':
        return 'Nemotron model bundle is incomplete for FluidAudio';
      case 'fluidaudio_unavailable':
        return 'FluidAudio runtime is not linked into this build';
      case 'microphone_permission_denied':
        return 'Microphone permission was denied';
      default:
        return 'Device ASR is unavailable: $reason';
    }
  }
}
