import 'dart:async';

import 'package:translation_mobile/src/app/app.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/compliance/data/compliance_consent_store.dart';
import 'package:translation_mobile/src/features/compliance/data/consent_audit_uploader.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/realtime/data/local_realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_settings_store.dart';
import 'package:translation_mobile/src/features/realtime/data/voice_preset_catalog.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/pages/realtime_page.dart';
import 'package:translation_mobile/src/features/shell/presentation/pages/main_shell_page.dart';
import 'package:translation_mobile/src/platform/asr/apple_speech_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/apple_speech_prerecorded_input.dart';
import 'package:translation_mobile/src/platform/audio/audio_capture.dart';
import 'package:translation_mobile/src/platform/audio/audio_frame.dart';
import 'package:translation_mobile/src/platform/audio/audio_session_coordinator.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';

/// Original app/widgets/controllers/providers; only I/O dependencies are scoped.
/// TTS is off: this test does not claim real microphone, AEC or listening quality.
class PrerecordedAppFixture {
  PrerecordedAppFixture(
      {required this.input,
      this.sourceLanguage = 'zh',
      this.targetLanguage = 'en',
      this.observeOnly = false});
  final AppleSpeechPrerecordedInput input;
  final String sourceLanguage, targetLanguage;
  final bool observeOnly;
  final store = _ObservedLocalSessionStore();
  final controllers = <RealtimeController>[];
  final providers = <AppleSpeechAsrProvider>[];
  final _subscriptions = <StreamSubscription<Map<String, Object?>>>[];
  final inputCompletions = <Map<String, Object?>>[];
  final inputObservations = <Map<String, Object?>>[];
  final capture = _NoPhysicalCapture();
  late final voiceCatalog = _NoNetworkVoiceCatalog();
  late final history =
      SessionHistoryRepository(localStore: store, shareService: _NoShare());

  late final config = AppConfig(
      apiBaseUrl: Uri.parse('http://127.0.0.1:1'),
      useMockAudio: false,
      useDeviceAsr: true,
      useOnDeviceTranslation: !observeOnly,
      useLocalSessions: true,
      onDeviceTranslationRequired: !observeOnly,
      deviceAsrProvider: 'apple_speech_transcriber',
      deviceAsrLanguage: sourceLanguage,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      autoReverseTargetLanguage: false,
      realtimeVoiceOutputMode: 'off',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 2240,
      serverOwnedHistory: false,
      appErrorReportingEnabled: false);

  RealtimeController get controller => controllers.last;
  AppleSpeechAsrProvider get provider => providers.last;
  List<Map<String, Object?>> get asrAvailabilityReports => [
        for (final provider in providers)
          for (final observed in provider.availabilityHistory)
            {
              'canStart': observed.canStart,
              'reason': observed.reason,
              'message': observed.message,
              'details': observed.details,
              'historyTruncated': provider.availabilityHistoryTruncated,
              if (provider.lastResourceFailure != null)
                'resourceFailure': provider.lastResourceFailure,
            }
      ];

  late final TranslationApp app = TranslationApp(
    complianceConsentStore: MemoryComplianceConsentStore.accepted(),
    consentAuditUploader: const NoopConsentAuditUploader(),
    shellPage: MainShellPage(
        config: config,
        historyRepository: history,
        realtimePage: RealtimePage(
            config: config,
            settingsStore: MemoryRealtimeSettingsStore(),
            accountSessionStore: MemoryAccountSessionStore(),
            voicePresetClient: voiceCatalog,
            controllerFactory: _controller)),
  );

  RealtimeController _controller(AppConfig effective) {
    final scoped = observeOnly
        ? effective.copyWith(useOnDeviceTranslation: false)
        : effective;
    if (!effective.useLocalSessions ||
        !effective.useDeviceAsr ||
        (!observeOnly && !effective.useOnDeviceTranslation) ||
        effective.realtimeVoiceOutputMode != 'off') {
      throw StateError(
          'Prerecorded validation only permits local models with TTS off');
    }
    final provider = AppleSpeechAsrProvider(prerecordedInput: input);
    providers.add(provider);
    _subscriptions.add(provider.inputEvents.listen((event) {
      if (event['type'] == 'input.completed') {
        inputCompletions.add(event);
      } else if (inputObservations.length < 2048) {
        inputObservations.add(event);
      } else {
        observationOverflow = true;
      }
    }));
    final controller = RealtimeController(
        config: scoped,
        repository: LocalRealtimeRepository(store: store),
        mobileAsrProvider: provider,
        audioCapture: capture,
        audioSessionCoordinator: const NoopAudioSessionCoordinator(),
        autoSpeakTranslation: false);
    controllers.add(controller);
    return controller;
  }

  Future<void> stop() async {
    for (final controller in controllers) {
      await controller.stop();
      // v1.0 stop() returns early if another stop is in flight. Never restore
      // paths while that original stop can still reach its async disk write.
      final deadline = DateTime.now().add(const Duration(seconds: 20));
      while (controller.status == RealtimeStatus.ending) {
        if (DateTime.now().isAfter(deadline)) {
          throw StateError('Original controller stop did not drain');
        }
        await Future<void>.delayed(const Duration(milliseconds: 20));
      }
    }
    await store.waitForWrites();
  }

  bool observationOverflow = false;

  /// Invoke after stop and widget unmount, before restoring the path scope.
  Future<void> drainAndClose() async {
    for (final controller in controllers) {
      await controller.disposeAsync();
    }
    for (final subscription in _subscriptions) {
      await subscription.cancel();
    }
    voiceCatalog.close();
    history.dispose();
  }
}

/// Observe final persistence only; the original store now writes v3 checkpoints.
class _ObservedLocalSessionStore extends LocalSessionStore {
  final _writes = <Future<void>>[];
  int get writeCount => _writes.length;
  int checkpointWriteCount = 0;
  @override
  Future<bool> putCheckpoint(LocalSessionCheckpoint record) {
    final write = super.putCheckpoint(record);
    checkpointWriteCount++;
    if (record.snapshot?.status == 'ended') {
      _writes.add(write.then<void>((_) {}));
    }
    return write;
  }
  @override
  Future<void> saveEndedSession(
      {required String sessionId,
      required DateTime createdAt,
      required List<SubtitleSegment> segments}) {
    final write = super.saveEndedSession(
        sessionId: sessionId, createdAt: createdAt, segments: segments);
    _writes.add(write);
    return write;
  }

  Future<void> waitForWrites() async {
    await Future.wait(_writes);
  }
}

class _NoNetworkVoiceCatalog extends VoicePresetClient {
  _NoNetworkVoiceCatalog() : super(baseUrl: Uri.parse('http://127.0.0.1:1'));
  @override
  Future<VoicePresetCatalog> load() async => const VoicePresetCatalog.empty();
}

class _NoPhysicalCapture implements AudioCapture {
  int startCalls = 0;
  @override
  Stream<AudioFrame> get frames => const Stream.empty();
  @override
  Future<void> start(AudioCaptureConfig config) async {
    startCalls++;
    throw StateError('Physical capture is forbidden');
  }

  @override
  Future<void> requestPermission() async =>
      throw StateError('Microphone permission is forbidden');
  @override
  Future<void> pause() async {}
  @override
  Future<void> resume() async =>
      throw StateError('Physical capture is forbidden');
  @override
  Future<void> stop() async {}
  @override
  Future<void> dispose() async {}
}

class _NoShare implements FileShareService {
  @override
  Future<String> saveExportFile(List<int> bytes, String filename) async =>
      throw StateError('Sharing is outside this test');
  @override
  Future<void> shareFile(String path, {String? mimeType}) async =>
      throw StateError('Sharing is outside this test');
}
