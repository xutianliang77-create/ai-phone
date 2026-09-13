import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_runtime_factories.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/translation/translation_language_pair.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';
import 'helpers/realtime_resource_fakes.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  for (final local in [true, false]) {
    for (final source in local ? ['fr'] : ['fr', 'auto']) {
      test('fixed target is not reversal; source=$source local=$local',
          () async {
        final f = _Fixture(
            resourceConfig(source: source).copyWith(useLocalSessions: local));
        await f.c.start();
        f.emit(['fr', 'ja', 'de']);
        await pumpEventQueue();
        expect(f.mt.checks.map(_direction),
            source == 'auto' ? ['fr->ja', 'de->ja'] : ['fr->ja']);
        expect(f.c.segments.map((s) => s.sourceLanguage), ['fr', 'ja', 'de']);
        expect(f.c.segments[1].translatedText, isEmpty);
        expect(f.mt.translations, source == 'auto' ? 2 : 1);
        await f.close();
      });
    }
    if (!local) {
      test('explicit A/A/B reversal never maps the third language to a default',
          () async {
        final f = _Fixture(resourceConfig().copyWith(
            useLocalSessions: false, autoReverseTargetLanguage: true));
        await f.c.start();
        f.emit(['fr', 'fr-CA', 'ja', 'de']);
        await pumpEventQueue();
        expect(f.mt.translations, 3);
        expect(f.c.segments.map((s) => s.targetLanguage),
            ['ja', 'ja', 'fr', null]);
        expect(f.c.segments.last.sourceLanguage, 'de');
        await f.c.stop();
        expect(f.repo.saved.last.translatedText, isEmpty);
        await f.close();
      });
    }
  }
  test(
      'blocks local automatic source before checking resources or creating a session',
      () async {
    final f = _Fixture(resourceConfig(source: 'auto'));
    await f.c.start();
    expect(f.c.status, RealtimeStatus.failed);
    expect(f.c.message, contains('Automatic language and reverse direction'));
    expect(f.repo.starts, 0);
    expect(f.asr.checks, isEmpty);
    expect(f.mt.checks, isEmpty);
    await f.close();
  });
  test(
      'blocks local automatic reverse before checking resources or creating a session',
      () async {
    final f =
        _Fixture(resourceConfig().copyWith(autoReverseTargetLanguage: true));
    await f.c.start();
    expect(f.c.status, RealtimeStatus.failed);
    expect(f.c.message, contains('Automatic language and reverse direction'));
    expect(f.repo.starts, 0);
    expect(f.asr.checks, isEmpty);
    expect(f.mt.checks, isEmpty);
    await f.close();
  });
  test('Apple preflight uses explicit pair and never infers an unknown source',
      () {
    expect(
        createOnDeviceTranslationPreflightConfigs(resourceConfig())
            .map(_direction),
        ['fr->ja']);
    expect(
        createOnDeviceTranslationPreflightConfigs(
            resourceConfig(source: 'auto')),
        isEmpty);
    expect(
        createOnDeviceTranslationPreflightConfigs(resourceConfig(source: 'auto')
            .copyWith(autoReverseTargetLanguage: true)),
        isEmpty);
    expect(
        createOnDeviceTranslationPreflightConfigs(
                resourceConfig().copyWith(autoReverseTargetLanguage: true))
            .map(_direction),
        ['fr->ja', 'ja->fr']);
    final stale = resourceConfig(target: 'de').copyWith(
        autoReverseTargetLanguage: true,
        automaticLanguagePair: const TranslationLanguagePair('fr', 'ja'));
    expect(explicitRealtimeLanguagePair(stale), isNull);
    expect(createOnDeviceTranslationPreflightConfigs(stale), isEmpty);
  });
  test('stale explicit pair blocks start before creating a session', () async {
    final f = _Fixture(resourceConfig(target: 'de').copyWith(
        autoReverseTargetLanguage: true,
        automaticLanguagePair: const TranslationLanguagePair('fr', 'ja')));
    await f.c.start();
    expect(f.c.status, RealtimeStatus.failed);
    expect(f.repo.starts, 0);
    expect(f.mt.checks, isEmpty);
    await f.close();
  });
  test('local automatic source cannot enter text routing', () async {
    final f = _Fixture(resourceConfig(source: 'auto'));
    await f.c.start();
    expect(f.c.status, RealtimeStatus.failed);
    expect(f.mt.translations, 0);
    expect(f.mt.checks, isEmpty);
    expect(f.c.segments, isEmpty);
    await f.close();
  });
}

String _direction(dynamic c) => '${c.sourceLanguage}->${c.targetLanguage}';

class _Fixture {
  _Fixture(AppConfig config) {
    asr.ready = true;
    mt.ready = true;
    c = RealtimeController(
        config: config,
        repository: repo,
        mobileAsrProvider: asr,
        mobileTranslationProvider: mt);
  }
  final asr = _Asr(), mt = _Mt(), repo = _Repo();
  late final RealtimeController c;
  void emit(List<String> languages) {
    for (final row in languages.indexed) {
      asr.events.add(AsrTextSegment(
          id: 'sentence-${row.$1}',
          text: 'bonjour',
          language: row.$2,
          languageEvidence: AsrLanguageEvidence.detected));
    }
  }

  Future<void> close() async {
    await c.stop();
    c.dispose();
    await c.disposeAsync();
    await asr.events.close();
  }
}

class _Asr extends ResourceAsr {
  final events = StreamController<AsrTextSegment>.broadcast();
  @override
  Stream<AsrTextSegment> get segments => events.stream;
}

class _Mt extends ResourceMt {
  @override
  Future<MobileTranslationResult?> translate(
      String text, MobileTranslationConfig config) async {
    translations++;
    return const MobileTranslationResult(text: 'translated', provider: 'test');
  }
}

class _Repo extends ResourceRepository {
  List<SubtitleSegment> saved = [];
  @override
  Future<RealtimeSession> startSession() async {
    starts++;
    return RealtimeSession(
        sessionId: 'local-route',
        realtimeToken: 'test',
        endpoint: Uri.parse('local://realtime'),
        expiresAt: DateTime.now().add(const Duration(minutes: 1)),
        maxDurationSeconds: 60);
  }

  @override
  Future<void> prepareFinalization(
      String sessionId, List<SubtitleSegment> segments,
      {int? billableSeconds}) async {}
  @override
  Future<void> end(String sessionId, List<SubtitleSegment> segments) async {
    saved = List.of(segments);
  }
}
