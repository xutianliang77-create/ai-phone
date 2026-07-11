import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/asr/android_system_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('translation_mobile/system_asr');
  late AndroidSystemAsrProvider provider;

  setUp(() {
    provider = AndroidSystemAsrProvider(methodChannel: channel);
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('allows start when Android system recognition is available', () async {
    _mockAvailability(channel, available: true);

    final availability = await provider.availability(
      const MobileAsrConfig(language: 'auto'),
    );

    expect(availability.canStart, isTrue);
    expect(availability.reason, 'ready');
    expect(availability.message, 'Android system ASR ready');
  });

  test('blocks start when microphone permission was denied', () async {
    _mockAvailability(
      channel,
      available: true,
      microphonePermission: 'denied',
    );

    final availability = await provider.availability(
      const MobileAsrConfig(language: 'auto'),
    );

    expect(availability.canStart, isFalse);
    expect(availability.reason, 'microphone_permission_denied');
    expect(availability.message, 'Microphone permission was denied');
  });

  test('blocks start when Android recognition service is unavailable',
      () async {
    _mockAvailability(channel, available: false);

    final availability = await provider.availability(
      const MobileAsrConfig(language: 'auto'),
    );

    expect(availability.canStart, isFalse);
    expect(availability.reason, 'system_asr_unavailable');
    expect(availability.message, contains('speech recognition is unavailable'));
  });

  test('passes language to native start', () async {
    Object? arguments;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'start') arguments = call.arguments;
      return null;
    });

    await provider.start(const MobileAsrConfig(language: 'zh'));

    expect(arguments, isA<Map>());
    expect((arguments! as Map)['language'], 'zh');
  });

  test('parses native ASR stream events and ignores state payloads', () async {
    const eventChannel =
        EventChannel('translation_mobile/system_asr/test_events');
    final controller = StreamController<Object?>.broadcast();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockStreamHandler(
            eventChannel, _TestStreamHandler(controller.stream));
    addTearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockStreamHandler(eventChannel, null);
      return controller.close();
    });
    provider = AndroidSystemAsrProvider(
      methodChannel: channel,
      eventChannel: eventChannel,
    );

    final received = <String>[];
    final subscription = provider.segments.listen((segment) {
      received.add('${segment.language}:${segment.text}:${segment.isFinal}');
    });
    addTearDown(subscription.cancel);

    controller.add(<String, Object?>{
      'type': 'system_asr_error',
      'message': 'speech_timeout',
    });
    controller.add(<String, Object?>{
      'text': 'hello',
      'language': 'en',
      'isFinal': false,
    });
    controller.add(<String, Object?>{
      'text': '你好',
      'language': 'zh',
      'isFinal': true,
    });
    await pumpEventQueue();

    expect(received, <String>['en:hello:false', 'zh:你好:true']);
  });
}

class _TestStreamHandler extends MockStreamHandler {
  _TestStreamHandler(this.stream);

  final Stream<Object?> stream;
  StreamSubscription<Object?>? _subscription;

  @override
  void onListen(Object? arguments, MockStreamHandlerEventSink events) {
    _subscription = stream.listen(events.success);
  }

  @override
  void onCancel(Object? arguments) {
    _subscription?.cancel();
  }
}

void _mockAvailability(
  MethodChannel channel, {
  required bool available,
  String microphonePermission = 'granted',
}) {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(channel, (call) async {
    if (call.method != 'isAvailable') return null;
    return <String, Object?>{
      'provider': 'android_system_asr',
      'available': available,
      'reason': available ? 'ready' : 'system_asr_unavailable',
      'microphone': <String, Object?>{
        'permission': microphonePermission,
      },
    };
  });
}
