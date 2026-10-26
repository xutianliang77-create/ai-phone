import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/history/data/owned_local_session_store.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/local_realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/platform/http/on_device_egress.dart';
import 'package:translation_mobile/src/platform/license/on_device_license.dart';
import 'package:translation_mobile/src/platform/translation/api_translation_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

AccountSession session(String owner) => AccountSession(
  token: 'fixture-$owner',
  ownerId: owner,
  deploymentId: 'wujie-v10-device-fixture',
  issuerOrigin: 'https://www.beelinkdata.com',
  expiresAtIso: '2099-01-01T00:00:00Z',
);
const lines = [
  SubtitleSegment(
    id: 'one',
    sourceText: 'private original',
    translatedText: 'private translation',
  ),
];
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'on-device egress rejects content routes, alternate hosts, queries and nested content',
    () {
      final base = Uri.parse(configuredAccountApiBaseUrl);
      expect(onDeviceExecution, true);
      for (final path in [
        '/realtime/sessions',
        '/translate',
        '/voice-presets',
        '/account/export?text=private',
      ]) {
        expect(
          () => requireOnDeviceControlRequest(
            base,
            'GET',
            base.resolve(path),
            null,
          ),
          throwsFormatException,
        );
      }
      expect(
        () => requireOnDeviceControlRequest(
          base,
          'POST',
          base.resolve('/v10/device/acquire'),
          '{"nested":{"text":"private"}}',
        ),
        throwsFormatException,
      );
      expect(
        () => requireOnDeviceControlRequest(
          base,
          'GET',
          Uri.parse('https://other.invalid/account/me'),
          null,
        ),
        throwsFormatException,
      );
      expect(
        () => requireOnDeviceControlRequest(
          base,
          'GET',
          base.resolve('/billing/entitlement'),
          null,
        ),
        returnsNormally,
      );
    },
  );
  test(
    'cloud translation cannot send content or fall back on device-only builds',
    () async {
      var calls = 0;
      final p = ApiTranslationProvider(
        baseUrl: Uri.parse('https://www.beelinkdata.com'),
        client: MockClient((_) async {
          calls++;
          throw StateError('should never send');
        }),
      );
      await expectLater(
        p.translate(
          'private source',
          const MobileTranslationConfig(
            sourceLanguage: 'zh',
            targetLanguage: 'en',
          ),
        ),
        throwsStateError,
      );
      expect(calls, 0);
    },
  );
  test(
    'saved online settings cannot turn the on-device formal configuration into server processing',
    () {
      final c = AppConfig(
        executionMode: 'on_device',
        apiBaseUrl: Uri.parse('https://www.beelinkdata.com'),
        distributionChannel: 'app_store',
        productProfile: 'core_translation',
        useMockAudio: false,
        useDeviceAsr: true,
        useLocalSessions: true,
        useOnDeviceTranslation: true,
        onDeviceTranslationRequired: true,
        deviceAsrProvider: 'apple_speech_transcriber',
        deviceAsrLanguage: 'zh',
        deviceAsrAutoDownloadModel: false,
        deviceAsrModelChunkMs: 2240,
        serverOwnedHistory: false,
      );
      final saved = RealtimeRuntimeSettings.fromJson({
        'processingMode': 'online',
        'sourceLanguage': 'zh',
        'targetLanguage': 'en',
      });
      expect(saved.isSupportedIn(c), false);
      final safe = saved.applyTo(c);
      expect(
        [
          c.deviceAsrChunkDurationMs,
          c.deviceAsrEndpointMinSpeechMs,
          c.deviceAsrEndpointSilenceMs,
        ],
        [32, 96, 640],
      );
      expect([
        safe.useDeviceAsr,
        safe.useLocalSessions,
        safe.useOnDeviceTranslation,
      ], everyElement(true));
      expect(() => c.copyWith(useLocalSessions: false), throwsStateError);
    },
  );
  test(
    'account files are isolated while the unowned legacy bytes remain unchanged',
    () async {
      final dir = Directory.systemTemp.createTempSync('v10-owned-');
      addTearDown(() => dir.deleteSync(recursive: true));
      final legacy = File('${dir.path}/translation-local-sessions.json')
        ..writeAsStringSync('{"sessions":[],"legacy":"keep"}');
      final account = MemoryAccountSessionStore(session('alice')),
          store = OwnedLocalSessionStore(
            account: account,
            directory: () async => dir,
          );
      await store.saveEndedSession(
        sessionId: 'alice-one',
        createdAt: DateTime.now(),
        segments: lines,
      );
      await account.save(session('bob'));
      expect(await store.listSessions(), isEmpty);
      await store.saveEndedSession(
        sessionId: 'bob-one',
        createdAt: DateTime.now(),
        segments: lines,
      );
      await account.save(session('alice'));
      expect((await store.listSessions()).single.sessionId, 'alice-one');
      expect(legacy.readAsStringSync(), '{"sessions":[],"legacy":"keep"}');
    },
  );
  test(
    'local sessions require the native license; stopping saves content without a charge or fresh license',
    () async {
      final dir = Directory.systemTemp.createTempSync('v10-licensed-');
      addTearDown(() => dir.deleteSync(recursive: true));
      final store = LocalSessionStore(file: File('${dir.path}/records.json')),
          license = FakeLicense();
      final r = LocalRealtimeRepository(store: store, license: license);
      addTearDown(r.dispose);
      license.valid = false;
      await expectLater(r.startSession(), throwsStateError);
      license.valid = true;
      final a = await r.startSession();
      expect(a.realtimeToken, 'verified-native-lease');
      expect(a.maxDurationSeconds, 0);
      await r.end(a.sessionId, lines);
      expect(
        (await store.getSession(a.sessionId)).segments.single.translatedText,
        'private translation',
      );
      expect(license.activityCalls.last, false);
      expect(license.valid, true);
    },
  );
  test(
    'parallel local saves are atomic and cannot overwrite another session',
    () async {
      final dir = Directory.systemTemp.createTempSync('v10-atomic-');
      addTearDown(() => dir.deleteSync(recursive: true));
      final file = File('${dir.path}/records.json');
      await Future.wait(
        List.generate(
          10,
          (n) => LocalSessionStore(file: file).saveEndedSession(
            sessionId: 's$n',
            createdAt: DateTime.now(),
            segments: lines,
          ),
        ),
      );
      expect((await LocalSessionStore(file: file).listSessions()).length, 10);
      expect(dir.listSync().whereType<File>().length, 1);
    },
  );
}

class FakeLicense implements OnDeviceLicense {
  bool valid = true;
  final activityCalls = <bool>[];
  final events = StreamController<void>.broadcast();
  @override
  Stream<void> get invalidations => events.stream;
  @override
  Future<DeviceLicenseSnapshot> ensureValid() async => DeviceLicenseSnapshot({
    'valid': valid,
    'leaseId': 'verified-native-lease',
    'remainingMs': 10000,
  });
  @override
  Future<void> activity(String scope, bool active) async {
    activityCalls.add(active);
  }
}
