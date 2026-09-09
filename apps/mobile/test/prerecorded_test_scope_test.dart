import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_settings_store.dart';

import '../integration_test/support/prerecorded_test_scope.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory support;
  setUp(() async {
    support = await Directory.systemTemp.createTemp('wujie-s2-scope-test-');
  });

  test(
      'original account/settings/history files stay unchanged; new writes use unique test root',
      () async {
    final previousPaths = PathProviderPlatform.instance;
    PathProviderPlatform.instance = _OriginalPaths(support);
    addTearDown(() {
      PathProviderPlatform.instance = previousPaths;
    });
    await const FileAccountSessionStore().save(const AccountSession(
        token: 'synthetic-original-token',
        expiresAtIso: '2000-01-01T00:00:00Z'));
    await const FileRealtimeSettingsStore()
        .save(RealtimeRuntimeSettings.fromConfig(AppConfig.fromEnvironment()));
    await LocalSessionStore().saveEndedSession(
        sessionId: 'original', createdAt: DateTime.now(), segments: []);
    expect((await const FileAccountSessionStore().load())?.token,
        'synthetic-original-token');
    expect(await const FileRealtimeSettingsStore().load(), isNotNull);
    expect((await LocalSessionStore().listSessions()).single.sessionId,
        'original');
    final originals = <File>[
      File('${support.path}/account_session.json'),
      File('${support.path}/realtime_settings.json'),
      File('${support.path}/translation-local-sessions.json'),
    ];
    final originalBytes =
        await Future.wait(originals.map((file) => file.readAsBytes()));
    final paths = PathProviderPlatform.instance;
    final scope = await PrerecordedTestScope.create(supportDirectory: support);
    try {
      expect(await const FileAccountSessionStore().load(), isNull);
      expect(await const FileRealtimeSettingsStore().load(), isNull);
      expect(await LocalSessionStore().listSessions(), isEmpty);
      await const FileAccountSessionStore().save(const AccountSession(
          token: 'synthetic-test-token', expiresAtIso: '2000-01-01T00:00:00Z'));
      await const FileRealtimeSettingsStore().save(
          RealtimeRuntimeSettings.fromConfig(AppConfig.fromEnvironment()));
      await LocalSessionStore().saveEndedSession(
          sessionId: 'synthetic-only', createdAt: DateTime.now(), segments: []);
      for (final directory in [
        await getApplicationSupportDirectory(),
        await getApplicationDocumentsDirectory(),
        await getTemporaryDirectory()
      ]) {
        expect(directory.path, startsWith('${scope.root.path}/'));
      }
      expect(
          await File('${scope.root.path}/support/account_session.json')
              .exists(),
          true);
      expect(
          await File('${scope.root.path}/support/realtime_settings.json')
              .exists(),
          true);
      expect((await LocalSessionStore().listSessions()).single.sessionId,
          'synthetic-only');
      for (var i = 0; i < originals.length; i++) {
        expect(await originals[i].readAsBytes(), originalBytes[i]);
      }
      await expectLater(PrerecordedTestScope.create(supportDirectory: support),
          throwsStateError);
      await expectLater(
          scope.writeReport('../escape.json', '{}'), throwsStateError);
    } finally {
      scope.close();
    }
    expect(identical(PathProviderPlatform.instance, paths), true);
    expect((await const FileAccountSessionStore().load())?.token,
        'synthetic-original-token');
    expect((await LocalSessionStore().listSessions()).single.sessionId,
        'original');
    final second = await PrerecordedTestScope.create(supportDirectory: support);
    expect(second.root.path, isNot(scope.root.path));
    second.close();
  });

  test('business HTTP fails before a socket and counts the attempt', () async {
    final scope = await PrerecordedTestScope.create(supportDirectory: support);
    try {
      await expectLater(http.get(Uri.parse('http://127.0.0.1:1/forbidden')),
          throwsA(isA<http.ClientException>()));
      expect(scope.blockedNetworkAttempts, 1);
    } finally {
      scope.close();
    }
  });

  test('staged input accepts only named regular bounded WAV files', () async {
    final inputs =
        await Directory('${support.path}/wujie-s2-prerecorded/inputs')
            .create(recursive: true);
    final file = File('${inputs.path}/fixture.wav');
    await file.writeAsBytes(Uint8List(44));
    final input = await PrerecordedTestScope.readStagedInput(
        name: 'fixture', sha256: 'a' * 64, supportDirectory: support);
    expect((input.toChannelArguments()['prerecordedInput'] as Map)['wav'],
        hasLength(44));
    await expectLater(
        PrerecordedTestScope.readStagedInput(
            name: '../fixture', sha256: 'a' * 64, supportDirectory: support),
        throwsArgumentError);
    await file.writeAsBytes(Uint8List(2000001));
    await expectLater(
        PrerecordedTestScope.readStagedInput(
            name: 'fixture', sha256: 'a' * 64, supportDirectory: support),
        throwsStateError);
    await Link('${inputs.path}/linked.wav').create(file.path);
    await expectLater(
        PrerecordedTestScope.readStagedInput(
            name: 'linked', sha256: 'a' * 64, supportDirectory: support),
        throwsStateError);
  });

  test('symlinked test root or input directory cannot redirect writes/reads',
      () async {
    final outside =
        await Directory.systemTemp.createTemp('wujie-s2-outside-test-');
    await Link('${support.path}/wujie-s2-prerecorded').create(outside.path);
    await expectLater(PrerecordedTestScope.create(supportDirectory: support),
        throwsStateError);
    await expectLater(
        PrerecordedTestScope.readStagedInput(
            name: 'fixture', sha256: 'a' * 64, supportDirectory: support),
        throwsStateError);
    final other =
        await Directory.systemTemp.createTemp('wujie-s2-input-link-test-');
    final base = await Directory('${other.path}/wujie-s2-prerecorded').create();
    await Link('${base.path}/inputs').create(outside.path);
    await expectLater(
        PrerecordedTestScope.readStagedInput(
            name: 'fixture', sha256: 'a' * 64, supportDirectory: other),
        throwsStateError);
  });
}

class _OriginalPaths extends PathProviderPlatform {
  _OriginalPaths(this.root);
  final Directory root;
  @override
  Future<String?> getApplicationSupportPath() async => root.path;
  @override
  Future<String?> getApplicationDocumentsPath() async => root.path;
}
