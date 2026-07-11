import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/asr/core_ml_nemotron_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('translation_mobile/core_ml_nemotron_asr');
  late CoreMlNemotronAsrProvider provider;

  setUp(() {
    provider = CoreMlNemotronAsrProvider(methodChannel: channel);
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('blocks start when model is missing and auto-download is off', () async {
    _mockAvailability(channel, reason: 'model_not_found');

    final availability = await provider.availability(
      const MobileAsrConfig(language: 'auto'),
    );

    expect(availability.canStart, isFalse);
    expect(availability.reason, 'model_not_found');
  });

  test('allows start when missing model can be downloaded', () async {
    _mockAvailability(channel, reason: 'model_not_found');

    final availability = await provider.availability(
      const MobileAsrConfig(
        language: 'auto',
        autoDownloadModel: true,
      ),
    );

    expect(availability.canStart, isTrue);
    expect(availability.message, contains('download'));
  });

  test('allows start after native prepare loaded a cached model', () async {
    _mockAvailability(
      channel,
      reason: 'ready',
      preparedModelReady: true,
    );

    final availability = await provider.availability(
      const MobileAsrConfig(language: 'auto'),
    );

    expect(availability.canStart, isTrue);
    expect(availability.reason, 'ready');
  });

  test('blocks start when microphone permission was denied', () async {
    _mockAvailability(
      channel,
      reason: 'ready',
      localModelReady: true,
      microphonePermission: 'denied',
    );

    final availability = await provider.availability(
      const MobileAsrConfig(
        language: 'auto',
        autoDownloadModel: true,
      ),
    );

    expect(availability.canStart, isFalse);
    expect(availability.reason, 'microphone_permission_denied');
    expect(availability.message, 'Microphone permission was denied');
  });

  test('passes model options to native prepare', () async {
    Object? arguments;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'prepare') {
        arguments = call.arguments;
      }
      return null;
    });

    await provider.prepare(
      const MobileAsrConfig(
        language: 'zh',
        chunkDurationMs: 640,
        modelChunkMs: 1120,
        autoDownloadModel: true,
        endpointMinSpeechMs: 800,
        endpointSilenceMs: 1400,
        endpointSpeechThresholdRms: 0.004,
      ),
    );

    expect(arguments, isA<Map>());
    expect((arguments! as Map)['language'], 'zh');
    expect((arguments! as Map)['chunkDurationMs'], 640);
    expect((arguments! as Map)['modelChunkMs'], 1120);
    expect((arguments! as Map)['autoDownloadModel'], isTrue);
    expect((arguments! as Map)['endpointMinSpeechMs'], 800);
    expect((arguments! as Map)['endpointSilenceMs'], 1400);
    expect((arguments! as Map)['endpointSpeechThresholdRms'], 0.004);
  });

  test('ignores malformed native ASR stream events', () async {
    const eventChannel =
        EventChannel('translation_mobile/core_ml_nemotron_asr/test_events');
    final controller = StreamController<Object?>.broadcast();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockStreamHandler(
      eventChannel,
      _TestStreamHandler(controller.stream),
    );
    addTearDown(controller.close);
    provider = CoreMlNemotronAsrProvider(
      methodChannel: channel,
      eventChannel: eventChannel,
    );

    final received = <String>[];
    final subscription = provider.segments.listen((segment) {
      received.add(segment.text);
    });
    addTearDown(subscription.cancel);

    controller.add(<String, Object?>{'text': ''});
    controller.add(<String, Object?>{'text': 'hello', 'language': 'en-US'});
    await pumpEventQueue();

    expect(received, <String>['hello']);
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
  required String reason,
  bool localModelReady = false,
  bool preparedModelReady = false,
  String microphonePermission = 'undetermined',
}) {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(channel, (call) async {
    if (call.method != 'isAvailable') return null;
    return <String, Object?>{
      'reason': reason,
      'localModelReady': localModelReady,
      'preparedModelReady': preparedModelReady,
      'microphone': <String, Object?>{
        'permission': microphonePermission,
      },
      'fluidAudio': <String, Object?>{
        'runtimeAvailable': true,
      },
    };
  });
}
