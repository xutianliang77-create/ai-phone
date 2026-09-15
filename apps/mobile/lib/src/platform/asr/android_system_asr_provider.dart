import 'dart:async';

import 'package:flutter/services.dart';

import 'asr_text_segment.dart';
import 'mobile_asr_provider.dart';

class AndroidSystemAsrProvider
    implements
        MobileAsrProvider,
        MobileAsrDiagnostics,
        MobileAsrRuntimeInspector {
  AndroidSystemAsrProvider({
    MethodChannel? methodChannel,
    EventChannel? eventChannel,
  })  : _methodChannel = methodChannel ??
            const MethodChannel('translation_mobile/system_asr'),
        _eventChannel = eventChannel ??
            const EventChannel('translation_mobile/system_asr/events');

  final MethodChannel _methodChannel;
  final EventChannel _eventChannel;
  Stream<AsrTextSegment>? _segments;

  @override
  Stream<AsrTextSegment> get segments {
    return _segments ??= _eventChannel
        .receiveBroadcastStream()
        .where((event) => event is Map)
        .map((event) => AsrTextSegment.tryFromJson(
              Map<String, Object?>.from(event as Map),
            ))
        .where((segment) => segment != null)
        .cast<AsrTextSegment>();
  }

  @override
  Future<Map<String, Object?>> nativeAvailability() => _availability();

  Future<Map<String, Object?>> _availability({String? language}) async {
    final result = await _methodChannel.invokeMapMethod<String, Object?>(
      'isAvailable',
      language == null ? null : <String, Object?>{'language': language},
    );
    return result ?? <String, Object?>{};
  }

  @override
  Future<MobileAsrAvailability> availability(MobileAsrConfig config) async {
    final payload = await _availability(language: config.language);
    final available = payload['available'] == true;
    final reason =
        payload['reason'] as String? ?? 'on_device_recognizer_unavailable';
    final microphonePermission =
        ((payload['microphone'] as Map?)?['permission']) as String?;

    if (microphonePermission == 'denied') {
      return MobileAsrAvailability(
        canStart: false,
        reason: 'microphone_permission_denied',
        message: 'Microphone permission was denied',
        details: payload,
      );
    }
    if (available) {
      return MobileAsrAvailability(
        canStart: true,
        reason: 'ready',
        message: 'Android on-device ASR ready',
        details: payload,
      );
    }
    return MobileAsrAvailability(
      canStart: false,
      reason: reason,
      message: 'Android on-device speech recognition is unavailable',
      details: payload,
    );
  }

  @override
  Future<void> requestPermission() async {
    await _methodChannel.invokeMethod<void>('requestPermission');
  }

  @override
  Future<void> start(MobileAsrConfig config) async {
    await _methodChannel.invokeMethod<void>('start', <String, Object?>{
      'language': config.language,
      if (config.captureId != null) 'captureId': config.captureId,
      if (config.languagePolicyKey != null)
        'languagePolicyKey': config.languagePolicyKey,
    });
  }

  @override
  Future<void> stop() async {
    await _methodChannel.invokeMethod<void>('stop');
  }

  @override
  Future<void> dispose() async {
    await stop();
  }
}
