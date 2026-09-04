import 'dart:async';

import 'package:flutter/services.dart';

enum AudioSessionEventType {
  interruptionBegan,
  interruptionEnded,
  routeChanged,
  captureInvalidated,
}

enum AudioOutputRoute {
  speaker,
  receiver,
  headphones,
  bluetooth,
  other;

  static AudioOutputRoute fromPlatformValue(Object? value) {
    return switch (value) {
      'speaker' => AudioOutputRoute.speaker,
      'receiver' => AudioOutputRoute.receiver,
      'headphones' => AudioOutputRoute.headphones,
      'bluetooth' => AudioOutputRoute.bluetooth,
      _ => AudioOutputRoute.other,
    };
  }

  bool get requiresAcousticEchoSuppression {
    return this != AudioOutputRoute.headphones &&
        this != AudioOutputRoute.bluetooth;
  }
}

class AudioSessionEvent {
  const AudioSessionEvent({
    required this.type,
    this.shouldResume = false,
    this.route,
  });

  final AudioSessionEventType type;
  final bool shouldResume;
  final AudioOutputRoute? route;

  static AudioSessionEvent? tryFromMap(Map<Object?, Object?> map) {
    final type = switch (map['type']) {
      'interruption.began' => AudioSessionEventType.interruptionBegan,
      'interruption.ended' => AudioSessionEventType.interruptionEnded,
      'route.changed' => AudioSessionEventType.routeChanged,
      'capture.invalidated' => AudioSessionEventType.captureInvalidated,
      _ => null,
    };
    if (type == null) return null;
    return AudioSessionEvent(
      type: type,
      shouldResume: map['shouldResume'] == true,
      route: type == AudioSessionEventType.routeChanged
          ? AudioOutputRoute.fromPlatformValue(map['route'])
          : null,
    );
  }
}

abstract interface class AudioSessionCoordinator {
  Stream<AudioSessionEvent> get events;
  bool get managesPlatformAudioSession;

  Future<void> beginCapture({bool voiceProcessing = true});
  Future<void> endCapture();
  Future<void> dispose();
}

class NoopAudioSessionCoordinator implements AudioSessionCoordinator {
  const NoopAudioSessionCoordinator();

  @override
  bool get managesPlatformAudioSession => false;

  @override
  Stream<AudioSessionEvent> get events => const Stream.empty();

  @override
  Future<void> beginCapture({bool voiceProcessing = true}) async {}

  @override
  Future<void> endCapture() async {}

  @override
  Future<void> dispose() async {}
}

class SystemAudioSessionCoordinator implements AudioSessionCoordinator {
  SystemAudioSessionCoordinator({
    EventChannel? eventChannel,
    MethodChannel? methodChannel,
  })  : _eventChannel = eventChannel ?? const EventChannel(_eventChannelName),
        _methodChannel =
            methodChannel ?? const MethodChannel(_methodChannelName);

  static const _eventChannelName = 'translation_mobile/audio_session/events';
  static const _methodChannelName = 'translation_mobile/audio_session';

  final EventChannel _eventChannel;
  final MethodChannel _methodChannel;
  Stream<AudioSessionEvent>? _events;

  @override
  bool get managesPlatformAudioSession => true;

  @override
  Stream<AudioSessionEvent> get events {
    return _events ??= _eventChannel
        .receiveBroadcastStream()
        .where((event) => event is Map)
        .map((event) => AudioSessionEvent.tryFromMap(
              Map<Object?, Object?>.from(event as Map),
            ))
        .where((event) => event != null)
        .cast<AudioSessionEvent>();
  }

  @override
  Future<void> beginCapture({bool voiceProcessing = true}) =>
      _methodChannel.invokeMethod<void>(
        'beginCapture',
        <String, Object?>{'voiceProcessing': voiceProcessing},
      );

  @override
  Future<void> endCapture() => _methodChannel.invokeMethod<void>('endCapture');

  @override
  Future<void> dispose() async {}
}
