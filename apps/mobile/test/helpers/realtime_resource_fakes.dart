import 'dart:async';

import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';
import 'resource_voice.dart';

AppConfig resourceConfig(
        {String source = 'fr', String target = 'ja', bool local = true}) =>
    AppConfig(
        apiBaseUrl: Uri.parse('http://127.0.0.1:1'),
        useLocalSessions: local,
        useDeviceAsr: local,
        useOnDeviceTranslation: local,
        onDeviceTranslationProvider: 'ios_system',
        deviceAsrProvider: 'apple_speech_transcriber',
        deviceAsrLanguage: source,
        deviceAsrModelChunkMs: 2240,
        serverOwnedHistory: false,
        sourceLanguage: source,
        targetLanguage: target,
        autoReverseTargetLanguage: false,
        useMockAudio: true,
        deviceAsrAutoDownloadModel: true,
        deviceAsrChunkDurationMs: 48,
        deviceAsrEndpointMinSpeechMs: 512,
        deviceAsrEndpointSilenceMs: 768);

class ResourceFixture {
  final asr = ResourceAsr();
  final mt = ResourceMt();
  final repo = ResourceRepository();
  final voice = ResourceVoice();
  RealtimeController controller({AppConfig? config}) => RealtimeController(
      config: config ?? resourceConfig(),
      repository: repo,
      mobileAsrProvider: asr,
      mobileTranslationProvider: mt,
      speechOutputProvider: voice);
}

class ResourceRepository extends RealtimeRepository {
  ResourceRepository()
      : super(
            apiClient:
                RealtimeApiClient(baseUrl: Uri.parse('http://127.0.0.1:1')),
            gatewayClient: RealtimeGatewayClient());
  int starts = 0;
  @override
  Future<RealtimeSession> startSession() async {
    starts++;
    throw StateError('No session may start in a resource-only test');
  }

  @override
  Future<void> recoverPendingFinalizations() async {}
}

class ResourceAsr
    implements
        MobileAsrProvider,
        MobileAsrDiagnostics,
        MobileAsrPreparation,
        MobileAsrResourcePreparation {
  bool ready = false, installOnPrepare = true;
  bool canPrepareLocally = false, installOnWarmup = false;
  String reason = 'languageResourceMissing';
  String? localeOverride;
  int starts = 0, permissions = 0;
  final checks = <MobileAsrConfig>[], warmups = <MobileAsrConfig>[];
  final preparations = <MobileAsrConfig>[];
  final requestIds = <String>[], cancellations = <String>[];
  Completer<void>? pending;
  Object? error;
  @override
  Future<MobileAsrAvailability> availability(MobileAsrConfig config) async {
    checks.add(config);
    return MobileAsrAvailability(
        canStart: ready,
        reason: ready ? 'ready' : reason,
        message: 'test readiness',
        details: {
          'locale': localeOverride ?? config.language,
          'canPrepareLocally': canPrepareLocally
        });
  }

  @override
  Future<void> prepareResources(MobileAsrConfig config,
      {required String requestId}) async {
    preparations.add(config);
    requestIds.add(requestId);
    await pending?.future;
    if (error != null) throw error!;
    if (installOnPrepare) ready = true;
  }

  @override
  Future<void> cancelResourcePreparation(String requestId) async {
    cancellations.add(requestId);
  }

  @override
  Future<void> prepare(MobileAsrConfig config) async {
    warmups.add(config);
    if (installOnWarmup) ready = true;
  }

  @override
  Future<void> requestPermission() async {
    permissions++;
  }

  @override
  Future<void> start(MobileAsrConfig config) async {
    starts++;
  }

  @override
  Stream<AsrTextSegment> get segments => const Stream.empty();
  @override
  Future<void> stop() async {}
  @override
  Future<void> dispose() async {}
}

class ResourceMt
    implements
        MobileTranslationProvider,
        MobileTranslationDiagnostics,
        MobileTranslationResourcePreparation {
  bool ready = false, installOnPrepare = true;
  String reason = 'language_pair_not_installed';
  int translations = 0;
  final checks = <MobileTranslationConfig>[],
      preparations = <MobileTranslationConfig>[];
  final requestIds = <String>[], cancellations = <String>[];
  Completer<void>? pending;
  Object? error;
  @override
  Future<MobileTranslationAvailability> availability(
      MobileTranslationConfig config) async {
    checks.add(config);
    return MobileTranslationAvailability(
        available: ready,
        provider: 'ios_system',
        sourceLanguage: config.sourceLanguage,
        targetLanguage: config.targetLanguage,
        status: ready ? 'installed' : 'supported',
        reason: ready ? 'ready' : reason);
  }

  @override
  Future<void> prepareResources(MobileTranslationConfig config,
      {required String requestId}) async {
    preparations.add(config);
    requestIds.add(requestId);
    await pending?.future;
    if (error != null) throw error!;
    if (installOnPrepare) ready = true;
  }

  @override
  Future<void> cancelResourcePreparation(String requestId) async {
    cancellations.add(requestId);
  }

  @override
  Future<MobileTranslationResult?> translate(
      String text, MobileTranslationConfig config) async {
    translations++;
    throw StateError('Preparation may not translate sample text');
  }

  @override
  Future<void> dispose() async {}
}
