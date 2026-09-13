import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_local_resource.dart';
import 'package:translation_mobile/src/platform/translation/translation_language_pair.dart';
import 'helpers/realtime_resource_fakes.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'checks actual target system voice even with reading off, without speaking or downloads',
      () async {
    final f = ResourceFixture();
    f.voice.ready = true;
    final c = f.controller();
    await c.checkLocalResources();
    final row =
        c.localResources.singleWhere((r) => r.kind == LocalResourceKind.speech);
    expect(row.sourceLanguage, 'ja');
    expect(row.voice?.language, 'ja');
    expect(row.voice?.identifier, 'com.apple.voice.test.ja');
    expect(row.reason, 'voice_available_on_device');
    expect(row.canPrepare, false);
    expect(f.voice.checks, ['ja']);
    expect(f.voice.speaks, 0);
    expect(f.repo.starts, 0);
    expect(f.mt.translations, 0);
    await c.prepareLocalResource(row.id, downloadAuthorized: true);
    expect(f.asr.preparations, isEmpty);
    expect(f.mt.preparations, isEmpty);
    c.dispose();
    await c.disposeAsync();
  });
  test(
      'fixed source with automatic reversal checks both explicit targets, unknown auto source checks no voices',
      () async {
    final f = ResourceFixture();
    final c = f.controller(
        config: resourceConfig(source: 'fr').copyWith(
            autoReverseTargetLanguage: true,
            automaticLanguagePair: const TranslationLanguagePair('fr', 'ja')));
    await c.checkLocalResources();
    expect(f.voice.checks, ['fr', 'ja']);
    c.dispose();
    await c.disposeAsync();
    final unknown = ResourceFixture();
    final u = unknown.controller(
        config: resourceConfig(source: 'auto')
            .copyWith(autoReverseTargetLanguage: true));
    await u.checkLocalResources();
    expect(unknown.voice.checks, isEmpty);
    u.dispose();
    await u.disposeAsync();
  });
  test(
      'online and unavailable voice do not fall back to local speech or download',
      () async {
    final f = ResourceFixture();
    final c = f.controller(config: resourceConfig(local: false));
    await c.checkLocalResources();
    expect(f.voice.checks, isEmpty);
    c.dispose();
    await c.disposeAsync();
    final local = ResourceFixture();
    final l = local.controller();
    await l.checkLocalResources();
    final row =
        l.localResources.singleWhere((r) => r.kind == LocalResourceKind.speech);
    expect(row.phase, LocalResourcePhase.failed);
    expect(row.reason, 'speech_voice_unavailable');
    expect(row.canPrepare, false);
    expect(local.voice.speaks, 0);
    l.dispose();
    await l.disposeAsync();
  });
}
