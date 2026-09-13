import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_local_resource.dart';
import 'package:translation_mobile/src/platform/translation/translation_language_pair.dart';

import 'helpers/realtime_resource_fakes.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late ResourceFixture f;
  late RealtimeController controller;
  setUp(() {
    f = ResourceFixture();
    controller = f.controller();
  });
  tearDown(() async {
    controller.dispose();
    await controller.disposeAsync();
  });
  test(
      'checks requested language and custom ASR parameters without permission, download or inference',
      () async {
    await controller.checkLocalResources();
    expect(_modelResources(controller).map((i) => i.id),
        ['asr|fr|', 'translation|fr|ja']);
    expect(
        _modelResources(controller)
            .every((i) => i.phase == LocalResourcePhase.missing),
        true);
    final config = f.asr.checks.single;
    expect(config.language, 'fr');
    expect(config.autoDownloadModel, false);
    expect(config.chunkDurationMs, 48);
    expect(config.endpointMinSpeechMs, 512);
    expect(config.endpointSilenceMs, 768);
    expect(f.mt.checks.single.targetLanguage, 'ja');
    expect(f.asr.preparations, isEmpty);
    expect(f.asr.permissions, 0);
    expect(f.asr.starts, 0);
    expect(f.repo.starts, 0);
    expect(f.mt.translations, 0);
  });
  test(
      'explicit preparation uses same provider and rechecks readiness; no silent authorization',
      () async {
    await controller.checkLocalResources();
    await controller.prepareLocalResource('asr|fr|', downloadAuthorized: false);
    expect(f.asr.preparations, isEmpty);
    await controller.prepareLocalResource('asr|fr|', downloadAuthorized: true);
    expect(f.asr.preparations.single.autoDownloadModel, true);
    expect(f.asr.preparations.single.language, 'fr');
    expect(f.asr.checks.length, 2);
    expect(_modelResources(controller).first.phase, LocalResourcePhase.ready);
    await controller.prepareLocalResource('translation|fr|ja',
        downloadAuthorized: true);
    expect(f.mt.preparations.single.sourceLanguage, 'fr');
    expect(f.mt.preparations.single.targetLanguage, 'ja');
    expect(f.mt.checks.length, 2);
    expect(_modelResources(controller).last.phase, LocalResourcePhase.ready);
    expect(f.asr.requestIds.single, isNot(f.mt.requestIds.single));
    expect(f.repo.starts, 0);
    expect(f.mt.translations, 0);
  });
  test('SDK request completion alone cannot mark resources ready', () async {
    f.mt.installOnPrepare = false;
    await controller.checkLocalResources();
    await controller.prepareLocalResource('translation|fr|ja',
        downloadAuthorized: true);
    expect(_modelResources(controller).last.phase, LocalResourcePhase.missing);
  });
  test('system downloading is not missing and cannot start another preparation',
      () async {
    f.asr.reason = 'language_resource_downloading';
    await controller.checkLocalResources();
    final asr = _modelResources(controller).first;
    expect(asr.phase, LocalResourcePhase.preparing);
    expect(asr.canPrepare, false);
    expect(controller.resourceOperationRunning, false);
    await controller.prepareLocalResource(asr.id, downloadAuthorized: true);
    expect(f.asr.preparations, isEmpty);
  });
  test(
      'listed locale without ready module requires explicit preparation and recheck',
      () async {
    f.asr.reason = 'language_resource_not_ready';
    await controller.checkLocalResources();
    final asr = _modelResources(controller).first;
    expect(asr.phase, LocalResourcePhase.failed);
    expect(asr.canPrepare, true);
    await controller.prepareLocalResource(asr.id, downloadAuthorized: false);
    expect(f.asr.preparations, isEmpty);
    await controller.prepareLocalResource(asr.id, downloadAuthorized: true);
    expect(_modelResources(controller).first.phase, LocalResourcePhase.ready);
    expect(f.asr.checks.length, 2);
    expect(f.asr.starts, 0);
  });
  test(
      'unsupported or unknown module status cannot be prepared as a missing pack',
      () async {
    for (final reason in ['unsupportedLanguage', 'resource_state_unknown']) {
      f.asr.reason = reason;
      await controller.checkLocalResources();
      final asr = _modelResources(controller).first;
      expect(
          asr.phase,
          reason == 'unsupportedLanguage'
              ? LocalResourcePhase.unsupported
              : LocalResourcePhase.failed);
      expect(asr.canPrepare, false);
    }
    expect(f.asr.preparations, isEmpty);
  });
  test('capture prewarming ignores the legacy automatic-download flag',
      () async {
    f.asr.ready = true;
    f.mt.ready = true;
    await controller
        .start(); // Fake repository intentionally rejects before capture.
    expect(f.asr.warmups.single.autoDownloadModel, false);
    expect(f.asr.preparations, isEmpty);
    expect(f.asr.starts, 0);
  });
  test(
      'installed Apple locale can register locally before readiness without download',
      () async {
    f.asr.canPrepareLocally = true;
    f.asr.installOnWarmup = true;
    f.mt.ready = true;
    await controller.start();
    expect(f.asr.warmups, hasLength(1));
    expect(f.asr.warmups.single.autoDownloadModel, false);
    expect(f.asr.checks, hasLength(2));
    expect(f.asr.checks.every((c) => c.language == 'fr'), true);
    expect(f.repo.starts, 1);
    expect(f.asr.preparations, isEmpty);
  });
  test(
      'local registration completion cannot bypass a failed second readiness check',
      () async {
    f.asr.canPrepareLocally = true;
    await controller.start();
    expect(f.asr.warmups, hasLength(1));
    expect(f.asr.checks, hasLength(2));
    expect(f.repo.starts, 0);
    expect(f.asr.starts, 0);
  });
  test('wrong locale cannot trigger implicit local registration', () async {
    f.asr.canPrepareLocally = true;
    f.asr.localeOverride = 'ja-JP';
    await controller.start();
    expect(f.asr.warmups, isEmpty);
    expect(f.repo.starts, 0);
  });
  testWidgets(
      'bounded resource timeout cancels the native request and rejects late success',
      (tester) async {
    f.mt.pending = Completer<void>();
    await controller.checkLocalResources();
    final pending = controller.prepareLocalResource('translation|fr|ja',
        downloadAuthorized: true);
    await tester.pump(const Duration(minutes: 5, seconds: 1));
    await pending;
    expect(_modelResources(controller).last.reason,
        'resource_preparation_timeout');
    expect(f.mt.cancellations, f.mt.requestIds);
    f.mt.pending!.complete();
    await tester.pump();
    expect(_modelResources(controller).last.phase, LocalResourcePhase.failed);
  });
  test('one in-flight operation blocks session start and duplicate prepare',
      () async {
    f.asr.pending = Completer<void>();
    await controller.checkLocalResources();
    final pending =
        controller.prepareLocalResource('asr|fr|', downloadAuthorized: true);
    await pumpEventQueue();
    expect(controller.resourceOperationRunning, true);
    expect(
        _modelResources(controller).first.phase, LocalResourcePhase.preparing);
    await controller.start();
    await controller.prepareLocalResource('asr|fr|', downloadAuthorized: true);
    expect(f.repo.starts, 0);
    expect(f.asr.preparations, hasLength(1));
    f.asr.pending!.complete();
    await pending;
    expect(controller.resourceOperationRunning, false);
  });
  test(
      'cancel carries identity, returns before noncooperative SDK and rejects its late result',
      () async {
    f.mt.pending = Completer<void>();
    await controller.checkLocalResources();
    final pending = controller.prepareLocalResource('translation|fr|ja',
        downloadAuthorized: true);
    await pumpEventQueue();
    await controller.cancelLocalResourcePreparation();
    await pending;
    expect(f.mt.cancellations, f.mt.requestIds);
    expect(
        _modelResources(controller).last.phase, LocalResourcePhase.cancelled);
    expect(controller.resourceOperationRunning, false);
    await controller.checkLocalResources();
    f.mt.pending!.complete();
    await pumpEventQueue();
    expect(_modelResources(controller).last.phase, LocalResourcePhase.missing);
  });
  test('dispose cancels resource operation and ignores late callbacks',
      () async {
    f.asr.pending = Completer<void>();
    await controller.checkLocalResources();
    final pending =
        controller.prepareLocalResource('asr|fr|', downloadAuthorized: true);
    await pumpEventQueue();
    controller.dispose();
    await controller.disposeAsync();
    await pending;
    expect(f.asr.cancellations, isNotEmpty);
    f.asr.pending!.complete();
    await pumpEventQueue();
    expect(_modelResources(controller).first.phase,
        isNot(LocalResourcePhase.ready));
  });
  test('online performs no local preparation or resource checks', () async {
    controller.dispose();
    controller = f.controller(config: resourceConfig(local: false));
    await controller.checkLocalResources();
    await controller.prepareLocalResource('asr|fr|', downloadAuthorized: true);
    expect(_modelResources(controller), isEmpty);
    expect(f.asr.checks, isEmpty);
    expect(f.mt.checks, isEmpty);
    expect(f.asr.preparations, isEmpty);
    expect(f.mt.preparations, isEmpty);
  });
  test('automatic source disables local resource checks', () async {
    controller.dispose();
    controller = f.controller(config: resourceConfig(source: 'auto'));
    await controller.checkLocalResources();
    expect(controller.onDeviceAutomaticLanguageUnsupported, isTrue);
    expect(controller.canCheckLocalResources, isFalse);
    expect(_modelResources(controller), isEmpty);
    expect(f.asr.checks, isEmpty);
    expect(f.mt.checks, isEmpty);
  });
  test('automatic pair also disables local resource checks', () async {
    controller.dispose();
    controller = f.controller(
        config: resourceConfig(source: 'auto').copyWith(
            autoReverseTargetLanguage: true,
            automaticLanguagePair: const TranslationLanguagePair('fr', 'ja')));
    await controller.checkLocalResources();
    expect(controller.onDeviceAutomaticLanguageUnsupported, isTrue);
    expect(controller.canCheckLocalResources, isFalse);
    expect(_modelResources(controller), isEmpty);
    expect(f.asr.checks, isEmpty);
    expect(f.mt.checks, isEmpty);
  });
  test(
      'wrong native locale, missing VAD and unsupported resources cannot be prepared as language packs',
      () async {
    f.asr.ready = true;
    f.asr.localeOverride = 'en-US';
    await controller.checkLocalResources();
    expect(
        _modelResources(controller).first.reason, 'resource_language_mismatch');
    expect(_modelResources(controller).first.canPrepare, false);
    f.asr.ready = false;
    f.asr.reason = 'sileroCorrupt';
    f.mt.reason = 'unsupported_language_pair';
    await controller.checkLocalResources();
    expect(_modelResources(controller).every((i) => !i.canPrepare), true);
  });
  for (final code in [
    'resource_storage_full',
    'resource_network_unavailable',
    'resource_preparation_cancelled'
  ]) {
    test('preserves native failure $code and permits explicit retry', () async {
      f.mt.error = PlatformException(code: code);
      await controller.checkLocalResources();
      await controller.prepareLocalResource('translation|fr|ja',
          downloadAuthorized: true);
      expect(_modelResources(controller).last.reason, code);
      expect(
          _modelResources(controller).last.phase,
          code.endsWith('cancelled')
              ? LocalResourcePhase.cancelled
              : LocalResourcePhase.failed);
      f.mt.error = null;
      await controller.prepareLocalResource('translation|fr|ja',
          downloadAuthorized: true);
      expect(_modelResources(controller).last.phase, LocalResourcePhase.ready);
    });
  }
}

List<RealtimeLocalResource> _modelResources(RealtimeController c) =>
    c.localResources.where((r) => r.kind != LocalResourceKind.speech).toList();
