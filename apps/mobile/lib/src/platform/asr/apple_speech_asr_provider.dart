import 'dart:async';
import 'package:flutter/services.dart';
import 'asr_text_segment.dart';
import 'mobile_asr_provider.dart';

/// Product-only adapter for the reused 1.1 SpeechAnalyzer session. Capture and
/// language identities fence stale callbacks; no file probe or cloud fallback.
class AppleSpeechAsrProvider
    implements MobileAsrProvider, MobileAsrDiagnostics, MobileAsrPreparation {
  AppleSpeechAsrProvider({MethodChannel? channel, EventChannel? events})
    : _method =
          channel ?? const MethodChannel('translation_mobile/apple_speech_asr'),
      _events =
          events ??
          const EventChannel('translation_mobile/apple_speech_asr/events');
  final MethodChannel _method;
  final EventChannel _events;
  String? _capture, _policy;
  Stream<AsrTextSegment>? _segments;
  @override
  Stream<AsrTextSegment> get segments => _segments ??= _events
      .receiveBroadcastStream()
      .where((v) => v is Map)
      .map((v) {
        final data = Map<String, Object?>.from(v as Map);
        if (_capture == null ||
            data['captureId'] != _capture ||
            data['languagePolicyKey'] != _policy) {
          return null;
        }
        if (data['type'] == 'runtime.error') {
          throw PlatformException(
            code: data['code'] as String? ?? 'apple_asr_runtime_error',
          );
        }
        return data['type'] == 'segment'
            ? AsrTextSegment.tryFromJson(data)
            : null;
      })
      .where((v) => v != null)
      .cast<AsrTextSegment>();
  Map<String, Object?> arguments(MobileAsrConfig c) => {
    'language': c.language,
    'autoDownloadModel': false,
    'chunkDurationMs': c.chunkDurationMs,
    'endpointMinSpeechMs': c.endpointMinSpeechMs,
    'endpointSilenceMs': c.endpointSilenceMs,
    'vadProvider': c.vadProvider,
    'vadThreshold': c.vadThreshold,
    'vadNegativeThreshold': c.vadNegativeThreshold,
    'vadPreRollMs': c.vadPreRollMs,
  };
  @override
  Future<MobileAsrAvailability> availability(MobileAsrConfig c) async {
    final p =
        await _method.invokeMapMethod<String, Object?>(
          'isAvailable',
          arguments(c),
        ) ??
        {};
    final effective = p['effectiveParameters'];
    final expected = arguments(c);
    final locales =
        (p['locales'] as List?)
            ?.whereType<String>()
            .map((v) => v.toLowerCase())
            .toList() ??
        const <String>[];
    final languageMatches = c.language == 'auto'
        ? p['automaticLanguageImplemented'] == true &&
              p['languagePolicy'] == 'apple-dual-zh-en-confidence-r1' &&
              const [
                'zh',
                'en',
              ].every((l) => locales.any((v) => v.startsWith(l)))
        : const ['zh', 'en'].contains(c.language) &&
              (p['locale'] as String? ?? '').toLowerCase().startsWith(
                c.language,
              );
    final matches =
        effective is Map &&
        const [
          'chunkDurationMs',
          'endpointMinSpeechMs',
          'endpointSilenceMs',
          'vadProvider',
          'vadThreshold',
          'vadNegativeThreshold',
          'vadPreRollMs',
        ].every((k) => expected[k] == effective[k]) &&
        effective['sampleRate'] == 16000 &&
        effective['vadFrameSamples'] == 4096 &&
        languageMatches &&
        RegExp(
          r'^[a-f0-9]{64}$',
        ).hasMatch(p['configurationFingerprint'] as String? ?? '');
    final reason = p['reason'] as String? ?? 'apple_asr_unavailable';
    return MobileAsrAvailability(
      canStart:
          matches && (p['canStart'] == true || p['canPrepareLocally'] == true),
      reason: reason,
      message: reason == 'automaticLanguageNotQualified'
          ? '请选择中文或英文；自动语种识别尚未通过验证。'
          : matches
          ? '本机识别资源：$reason'
          : '本机识别参数或语言资源未就绪',
      details: p,
    );
  }

  @override
  Future<void> requestPermission() =>
      _method.invokeMethod<void>('requestPermission');
  @override
  Future<void> prepare(MobileAsrConfig c) =>
      _method.invokeMethod<void>('prepare', arguments(c));
  Future<void> prepareResources(MobileAsrConfig c, String requestId) =>
      _method.invokeMethod<void>('prepare', {
        ...arguments(c),
        'autoDownloadModel': true,
        'downloadAuthorized': true,
        'requestId': requestId,
      });
  Future<void> cancelPreparation(String requestId) =>
      _method.invokeMethod<void>('cancelPreparation', {'requestId': requestId});
  @override
  Future<void> start(MobileAsrConfig c) async {
    _capture = 'capture-${DateTime.now().microsecondsSinceEpoch}';
    _policy = c.language == 'auto'
        ? 'apple-dual-zh-en-confidence-r1'
        : 'fixed-${c.language}';
    await _method.invokeMethod<void>('start', {
      ...arguments(c),
      'captureId': _capture,
      'languagePolicyKey': _policy,
    });
  }

  @override
  Future<void> stop() async {
    await _method.invokeMethod<void>('stop');
    // Keep the legal stop tail identity until the next start fences it.
  }

  @override
  Future<void> dispose() => stop();
}
