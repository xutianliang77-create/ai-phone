import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

const deviceSpeakerProfile = 'sortformer_v2_1_fastest';
const deviceSpeakerRevision = 'ae9a27ab45dc0aa3abede7d2d6bad2b7a69aa6d1';
const deviceSpeakerSelection = <String, Object?>{
  'mode': 'diarization', 'deviceProfile': deviceSpeakerProfile,
  'maxSpeakers': 4, 'allowVoiceIdentity': false,
};

bool deviceSpeakerOffered(Object? value) => value is Map &&
    value['available'] == true && value['id'] == deviceSpeakerProfile &&
    value['revision'] == deviceSpeakerRevision && value['maxSpeakers'] == 4 &&
    value['execution'] == 'on_device' && value['anonymousOnly'] == true &&
    value['requiresLocalReadiness'] == true;

abstract class DeviceSpeakerDiarizer {
  Future<bool> prepare();
  Stream<Map<String, Object?>> get events;
  Future<void> start(String sessionId, int sampleRate);
  Future<void> accept(String sessionId, int startSample, List<int> pcm);
  Future<List<Map<String, Object?>>> finish(String sessionId);
  Future<void> cancel(String sessionId);
}

DeviceSpeakerDiarizer? createDeviceSpeakerDiarizer() {
  if (!const bool.fromEnvironment('ENABLE_DEVICE_SPEAKER', defaultValue: true) ||
      kIsWeb || defaultTargetPlatform != TargetPlatform.iOS) {
    return null;
  }
  final model = NativeDeviceSpeakerDiarizer();
  // Prepare before Start, without opening a microphone, downloading, or
  // changing the current session. Native preparation is shared across rebuilds.
  if (const String.fromEnvironment('PUBLIC_DEPLOYMENT_ID').isNotEmpty) {
    unawaited(model.prepare());
  }
  return model;
}

enum DeviceSpeakerReadiness {
  notRequested, loading, ready, waitTimedOut, loadTimedOut, pluginMissing,
  modelMissing, modelInvalid, busy, cancelled, profileMismatch, loadFailed,
}

Future<void> recordDeviceSpeakerSelection(String reason) async {
  if(kIsWeb||defaultTargetPlatform!=TargetPlatform.iOS)return;
  try {
    await const MethodChannel('translation_mobile/device_speaker')
        .invokeMethod<void>('recordPreparationDecision', {'reason':reason})
        .timeout(const Duration(milliseconds:250));
  } catch (_) { /* Diagnostic only; never blocks the online session. */ }
}

/// Same uploaded PCM, no microphone or model-download API. A failed candidate
/// remains an anonymous-speaker session; cloud ASR/MT selection never changes.
class NativeDeviceSpeakerDiarizer implements DeviceSpeakerDiarizer {
  NativeDeviceSpeakerDiarizer({MethodChannel? channel, Stream<dynamic>? stream,
      this.readinessWait = const Duration(milliseconds: 1500)})
      : _channel = channel ?? const MethodChannel('translation_mobile/device_speaker'),
        _stream = stream ?? const EventChannel('translation_mobile/device_speaker/events').receiveBroadcastStream();
  final MethodChannel _channel;
  final Stream<dynamic> _stream;
  final Duration readinessWait;
  Future<bool>? _preparation;
  DeviceSpeakerReadiness readiness = DeviceSpeakerReadiness.notRequested;
  static int _request = 0;
  @override
  Stream<Map<String, Object?>> get events => _stream.map((e) => Map<String, Object?>.from(e as Map));
  @override
  Future<bool> prepare() async {
    // First CoreML/ANE preparation can be slow. Never make cloud ASR wait for
    // it: the current session stays anonymous, and a later start rechecks the
    // same completed local preparation. There is no mid-session model switch.
    final loading = _preparation ??= _prepareOnce();
    final wait = Stopwatch()..start();
    return loading.timeout(readinessWait, onTimeout: () {
      readiness = DeviceSpeakerReadiness.waitTimedOut;
      unawaited(_channel.invokeMethod<void>('recordPreparationDecision',
          {'reason': readiness.name, 'elapsedMs': wait.elapsedMilliseconds}).catchError((Object _) {}));
      return false;
    });
  }
  Future<bool> _prepareOnce() async {
    final id = 'speaker-${DateTime.now().microsecondsSinceEpoch}-${++_request}';
    readiness = DeviceSpeakerReadiness.loading;
    try {
      final result = await _channel.invokeMapMethod<String, Object?>('prepare', {'requestId': id})
          .timeout(const Duration(minutes: 3));
      final ready = result?['ready'] == true && result?['profile'] == deviceSpeakerProfile &&
          result?['modelRevision'] == deviceSpeakerRevision && result?['maxSpeakers'] == 4;
      readiness = ready ? DeviceSpeakerReadiness.ready : DeviceSpeakerReadiness.profileMismatch;
      if (!ready) _preparation = null;
      return ready;
    } catch (error) {
      readiness = switch (error) {
        TimeoutException() => DeviceSpeakerReadiness.loadTimedOut,
        MissingPluginException() => DeviceSpeakerReadiness.pluginMissing,
        PlatformException(code: 'device_speaker_model_missing') => DeviceSpeakerReadiness.modelMissing,
        PlatformException(code: 'device_speaker_model_invalid') => DeviceSpeakerReadiness.modelInvalid,
        PlatformException(code: 'device_speaker_busy') => DeviceSpeakerReadiness.busy,
        PlatformException(code: 'device_speaker_cancelled') => DeviceSpeakerReadiness.cancelled,
        _ => DeviceSpeakerReadiness.loadFailed,
      };
      _preparation = null;
      unawaited(_channel.invokeMethod<void>('cancelPreparation', {'requestId': id}).catchError((Object _) {}));
      return false;
    }
  }
  @override
  Future<void> start(String sessionId, int sampleRate) async {
    final result = await _channel.invokeMapMethod<String, Object?>('start',
        {'sessionId': sessionId, 'sampleRate': sampleRate,
          if (const bool.fromEnvironment('ENABLE_ONLINE_EVIDENCE_TRACE'))
            'diagnosticCaptureEnabled': true}).timeout(const Duration(seconds: 5));
    if (result?['sessionId'] != sessionId || result?['ready'] != true) {
      throw StateError('device_speaker_start_failed');
    }
  }
  @override
  Future<void> accept(String sessionId, int startSample, List<int> pcm) =>
      _channel.invokeMethod<void>('accept', {'sessionId': sessionId, 'startSample': startSample, 'pcm': Uint8List.fromList(pcm)})
          .timeout(const Duration(seconds: 2));
  @override
  Future<List<Map<String, Object?>>> finish(String sessionId) async {
    final result = await _channel.invokeMapMethod<String, Object?>('finish', {'sessionId': sessionId});
    if (result?['sessionId'] != sessionId || result?['evidence'] is! List) {
      throw StateError('device_speaker_finish_failed');
    }
    return (result!['evidence'] as List).map((e) => Map<String, Object?>.from(e as Map)).toList();
  }
  @override
  Future<void> cancel(String sessionId) => _channel.invokeMethod<void>('cancel', {'sessionId': sessionId});
}
