import 'dart:async';

import 'package:flutter/services.dart';

import 'asr_text_segment.dart';
import 'apple_speech_prerecorded_input.dart';
import 'mobile_asr_provider.dart';

/// Uses the existing realtime controller and repositories, not a separate UI.
class AppleSpeechAsrProvider
    implements
        MobileAsrProvider,
        MobileAsrDiagnostics,
        MobileAsrPreparation,
        MobileAsrResourcePreparation {
  AppleSpeechAsrProvider(
      {MethodChannel? methodChannel,
      EventChannel? eventChannel,
      this.prerecordedInput})
      : _method = methodChannel ??
            const MethodChannel('translation_mobile/apple_speech_asr'),
        _events = eventChannel ??
            const EventChannel('translation_mobile/apple_speech_asr/events');

  final MethodChannel _method;
  final EventChannel _events;
  final AppleSpeechPrerecordedInput? prerecordedInput;
  final _inputEvents = StreamController<Map<String, Object?>>.broadcast();
  bool _prerecordedRunning = false;
  Stream<Map<String, Object?>> get inputEvents => _inputEvents.stream;
  Stream<AsrTextSegment>? _segments;
  String? _captureId;
  String? _languagePolicyKey;
  MobileAsrAvailability? _lastAvailability;

  /// The exact preflight used by the original controller, not a later recheck.
  MobileAsrAvailability? get lastAvailability => _lastAvailability;
  Map<String, Object?>? _lastResourceFailure;
  Map<String, Object?>? get lastResourceFailure => _lastResourceFailure;
  final _availabilityHistory = <MobileAsrAvailability>[];
  List<MobileAsrAvailability> get availabilityHistory =>
      List.unmodifiable(_availabilityHistory);
  bool availabilityHistoryTruncated = false;

  @override
  Stream<AsrTextSegment> get segments => _segments ??= _events
      .receiveBroadcastStream()
      .where((event) => event is Map)
      .map((event) {
        final data = Map<String, Object?>.from(event as Map);
        if (prerecordedInput != null &&
            (_captureId == null || _languagePolicyKey == null)) {
          return null;
        }
        if (_captureId != null && data['captureId'] != _captureId) return null;
        if (_languagePolicyKey != null &&
            data['languagePolicyKey'] != _languagePolicyKey) {
          return null;
        }
        if (data['type'] == 'input.completed') {
          if (_prerecordedRunning && !_inputEvents.isClosed) {
            _inputEvents.add(Map.unmodifiable(data));
          }
          return null;
        }
        if (prerecordedInput != null &&
            const ['probe.raw_segment', 'vad.boundary']
                .contains(data['type'])) {
          // Captured only in the original-app prerecorded QA path, including
          // the legal stop tail. Diagnostic text cannot become a subtitle.
          if (!_inputEvents.isClosed) _inputEvents.add(Map.unmodifiable(data));
          return null;
        }
        if (data['type'] == 'runtime.error') {
          throw PlatformException(
            code: data['code'] as String? ?? 'apple_asr_runtime_error',
            message: data['message'] as String?,
            details: data,
          );
        }
        // VAD boundaries cannot become final text or trigger translation alone.
        return data['type'] == 'segment'
            ? AsrTextSegment.tryFromJson(data)
            : null;
      })
      .where((segment) => segment != null)
      .cast<AsrTextSegment>();

  Map<String, Object?> _arguments(MobileAsrConfig config) => {
        if (prerecordedInput != null) ...prerecordedInput!.toChannelArguments(),
        'language': config.language,
        'autoDownloadModel': config.autoDownloadModel,
        'chunkDurationMs': config.chunkDurationMs,
        'endpointMinSpeechMs': config.endpointMinSpeechMs,
        'endpointSilenceMs': config.endpointSilenceMs,
        'vadProvider': config.vadProvider,
        'vadThreshold': config.vadThreshold,
        'vadNegativeThreshold': config.vadNegativeThreshold,
        'vadPreRollMs': config.vadPreRollMs,
        if (config.captureId != null) 'captureId': config.captureId,
        if (config.languagePolicyKey != null)
          'languagePolicyKey': config.languagePolicyKey,
      };

  @override
  Future<MobileAsrAvailability> availability(MobileAsrConfig config) async {
    _lastAvailability = null;
    _lastResourceFailure = null;
    final payload = await _method.invokeMapMethod<String, Object?>(
          'isAvailable',
          _arguments(config),
        ) ??
        <String, Object?>{};
    final matchesConfiguration =
        _matchesEffectiveConfiguration(payload, config) &&
            normalizeAsrLanguage(config.language) != null &&
            normalizeAsrLanguage(payload['locale'] as String? ?? '') ==
                normalizeAsrLanguage(config.language) &&
            (prerecordedInput == null || payload['inputKind'] == 'prerecorded');
    final reason =
        (payload['canStart'] == true || payload['canPrepareLocally'] == true) &&
                !matchesConfiguration
            ? 'asr_configuration_mismatch'
            : payload['reason'] as String? ?? 'apple_asr_unavailable';
    final observed = _lastAvailability = MobileAsrAvailability(
      canStart: payload['canStart'] == true && matchesConfiguration,
      reason: reason,
      message: reason == 'automaticLanguageNotQualified'
          ? 'Select a supported source language; automatic Apple ASR language routing is not qualified yet.'
          : 'Apple SpeechTranscriber: $reason',
      details: Map.unmodifiable({
        ...payload,
        'canPrepareLocally':
            payload['canPrepareLocally'] == true && matchesConfiguration,
      }),
    );
    if (_availabilityHistory.length == 8) {
      _availabilityHistory.removeAt(0);
      availabilityHistoryTruncated = true;
    }
    _availabilityHistory.add(observed);
    return observed;
  }

  bool _matchesEffectiveConfiguration(
      Map<String, Object?> payload, MobileAsrConfig config) {
    final effective = payload['effectiveParameters'];
    final fingerprint = payload['configurationFingerprint'];
    if (effective is! Map ||
        fingerprint is! String ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(fingerprint)) {
      return false;
    }
    final expected = _arguments(config);
    return const [
          'chunkDurationMs',
          'endpointMinSpeechMs',
          'endpointSilenceMs',
          'vadProvider',
          'vadThreshold',
          'vadNegativeThreshold',
          'vadPreRollMs'
        ].every((key) => effective[key] == expected[key]) &&
        effective['sampleRate'] == 16000 &&
        effective['vadFrameSamples'] == 4096;
  }

  @override
  Future<void> requestPermission() => _method.invokeMethod<void>(
      'requestPermission', prerecordedInput?.toChannelArguments());
  @override
  Future<void> prepare(MobileAsrConfig config) {
    _validatePrerecordedConfig(config);
    return _resourceCall('prepare', _arguments(config));
  }

  @override
  Future<void> prepareResources(MobileAsrConfig config,
      {required String requestId}) {
    _validatePrerecordedConfig(config);
    if (requestId.isEmpty ||
        !config.autoDownloadModel ||
        prerecordedInput != null) {
      throw ArgumentError(
          'Explicit normal-app resource preparation is required');
    }
    return _resourceCall('prepare', {
      ..._arguments(config),
      'requestId': requestId,
      'downloadAuthorized': true,
    });
  }

  @override
  Future<void> cancelResourcePreparation(String requestId) =>
      _method.invokeMethod<void>('cancelPreparation', {'requestId': requestId});

  @override
  Future<void> start(MobileAsrConfig config) async {
    _validatePrerecordedConfig(config);
    if (prerecordedInput != null &&
        (config.captureId?.isNotEmpty != true ||
            config.languagePolicyKey?.isNotEmpty != true)) {
      throw ArgumentError(
          'Prerecorded input requires capture and language identities');
    }
    _captureId = config.captureId;
    _languagePolicyKey = config.languagePolicyKey;
    _prerecordedRunning = prerecordedInput != null;
    try {
      await _resourceCall('start', _arguments(config));
    } catch (_) {
      _prerecordedRunning = false;
      rethrow;
    }
  }

  @override
  Future<void> stop() {
    _prerecordedRunning = false;
    return _method.invokeMethod<void>('stop');
  }

  Future<Map<String, Object?>> runtimeDiagnostics() async =>
      await _method.invokeMapMethod<String, Object?>('diagnostics') ?? const {};
  Future<void> _resourceCall(String method, Map<String, Object?> args) async {
    try {
      await _method.invokeMethod<void>(method, args);
    } on PlatformException catch (error) {
      _lastResourceFailure = Map.unmodifiable({
        'method': method,
        'code': error.code,
        'message': error.message,
        'details': error.details,
      });
      rethrow;
    }
  }

  @override
  Future<void> dispose() async {
    try {
      await stop();
    } finally {
      await _inputEvents.close();
    }
  }

  void _validatePrerecordedConfig(MobileAsrConfig config) {
    if (prerecordedInput != null && config.autoDownloadModel) {
      throw ArgumentError(
          'Prerecorded validation cannot download model resources');
    }
  }
}
