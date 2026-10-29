import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/realtime/data/local_realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';
import 'package:translation_mobile/src/platform/speech/speech_output_provider.dart';
import 'package:translation_mobile/src/platform/license/on_device_license.dart';
import 'helpers/realtime_controller_test_helpers.dart' show FakeAudioCapture;

/// Actual product controller/repository lifecycle with deterministic component
/// doubles. It proves wiring/cancellation/persistence, never translation quality.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  AppConfig config() => AppConfig(
    executionMode: 'on_device',
    apiBaseUrl: Uri.parse('https://www.beelinkdata.com'),
    distributionChannel: 'app_store',
    productProfile: 'core_translation',
    useMockAudio: false,
    useDeviceAsr: true,
    useLocalSessions: true,
    useOnDeviceTranslation: true,
    onDeviceTranslationRequired: true,
    sourceLanguage: 'zh',
    targetLanguage: 'en',
    deviceAsrProvider: 'apple_speech_transcriber',
    deviceAsrLanguage: 'zh',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: false,
  );
  test(
    'local wiring readies components before authorization, interrupts old speech, then saves and stops at license expiry',
    () async {
      final calls = <String>[],
          asr = _Asr(calls),
          mt = _Translation(calls),
          speech = _Speech(calls),
          license = _License(calls);
      final dir = Directory.systemTemp.createTempSync('v10-pipeline-');
      addTearDown(() => dir.deleteSync(recursive: true));
      final store = LocalSessionStore(file: File('${dir.path}/records.json'));
      final repository = LocalRealtimeRepository(
        store: store,
        license: license,
      );
      final c = RealtimeController(
        config: config(),
        repository: repository,
        mobileAsrProvider: asr,
        mobileTranslationProvider: mt,
        speechOutputProvider: speech,
        audioCapture: FakeAudioCapture(),
        autoSpeakTranslation: true,
      );
      addTearDown(c.dispose);
      await c.start();
      expect(c.status, RealtimeStatus.active);
      expect(
        calls.indexOf('asr.prepare'),
        lessThan(calls.indexOf('license.ensure')),
      );
      expect(
        calls.indexOf('tts.prepare.en'),
        lessThan(calls.indexOf('license.ensure')),
      );
      expect(calls.indexOf('license.ensure'), lessThan(calls.indexOf('mt.warm')));
      expect(calls.indexOf('mt.warm'), lessThan(calls.indexOf('asr.start')));
      asr.emit('one', '不是取消订单，而是推迟发货');
      await _until(() => speech.texts.length == 1);
      asr.emit('two', '改为明天下午发货');
      await _until(() => speech.texts.length == 2);
      expect(calls.indexOf('tts.stop'), lessThan(calls.indexOf('tts.begin.2')));
      expect(c.segments.length, 2);
      expect(c.segments.last.translatedText, isNotEmpty);
      license.valid = false;
      license.invalidationsController.add(null);
      await _until(() => c.status == RealtimeStatus.failed);
      await _until(() => license.scopes.isEmpty);
      await _untilAsync(() async => (await store.listSessions()).isNotEmpty);
      final saved = (await store.listSessions()).single;
      expect((await store.getSession(saved.sessionId)).segments.length, 2);
      final prior = mt.calls;
      asr.emit('late', '到期后的新句');
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(mt.calls, prior);
      expect(license.ensures, 1);
    },
  );
  test(
    'missing ASR resources never acquire a license or start capture',
    () async {
      final calls = <String>[],
          asr = _Asr(calls)..ready = false,
          license = _License(calls);
      final dir = Directory.systemTemp.createTempSync('v10-not-ready-');
      addTearDown(() => dir.deleteSync(recursive: true));
      final c = RealtimeController(
        config: config(),
        repository: LocalRealtimeRepository(
          store: LocalSessionStore(file: File('${dir.path}/r.json')),
          license: license,
        ),
        mobileAsrProvider: asr,
        mobileTranslationProvider: _Translation(calls),
        speechOutputProvider: _Speech(calls),
        audioCapture: FakeAudioCapture(),
        autoSpeakTranslation: true,
      );
      addTearDown(c.dispose);
      await c.start();
      expect(c.status, RealtimeStatus.failed);
      expect(license.ensures, 0);
      expect(calls, isNot(contains('asr.start')));
    },
  );

  test('stop during translation warmup cancels preparation and never starts ASR', () async {
    final calls=<String>[], asr=_Asr(calls), mt=_BlockedWarmTranslation(calls), license=_License(calls);
    final dir=Directory.systemTemp.createTempSync('v10-warm-cancel-');
    addTearDown(() => dir.deleteSync(recursive:true));
    final c=RealtimeController(config:config().copyWith(sourceLanguage:'auto',autoReverseTargetLanguage:true),
      repository:LocalRealtimeRepository(store:LocalSessionStore(file:File('${dir.path}/r.json')),license:license),
      mobileAsrProvider:asr,mobileTranslationProvider:mt,speechOutputProvider:_Speech(calls),
      audioCapture:FakeAudioCapture(),autoSpeakTranslation:false);
    addTearDown(c.dispose);
    final starting=c.start();
    await _until(() => calls.contains('mt.warm'));
    expect(c.status,RealtimeStatus.connecting);
    await c.stop();
    await starting;
    expect(calls,contains('mt.warm.cancel'));
    expect(calls.where((call) => call == 'mt.warm').length,1);
    expect(calls,isNot(contains('asr.start')));
    expect(c.status,RealtimeStatus.ended);
  });

  test('late translation from a failed session cannot enter the next one', () async {
    final calls=<String>[], asr=_Asr(calls), license=_License(calls), mt=_BlockedTranslation(calls);
    final dir=Directory.systemTemp.createTempSync('v10-late-translation-');
    addTearDown(() => dir.deleteSync(recursive:true));
    final c=RealtimeController(config:config().copyWith(sourceLanguage:'auto'),
      repository:LocalRealtimeRepository(store:LocalSessionStore(file:File('${dir.path}/r.json')),license:license),
      mobileAsrProvider:asr,mobileTranslationProvider:mt,speechOutputProvider:_Speech(calls),
      audioCapture:FakeAudioCapture(),autoSpeakTranslation:false);
    addTearDown(c.dispose); await c.start(); asr.emit('old','旧会话内容');
    await _until(() => mt.calls==1);
    asr.controller.addError(StateError('synthetic ASR failure'));
    await _until(() => c.status==RealtimeStatus.failed);
    await c.start(); expect(c.status,RealtimeStatus.active); expect(c.segments,isEmpty);
    mt.block.complete(const MobileTranslationResult(text:'old-session translation',provider:'fixture'));
    await Future<void>.delayed(const Duration(milliseconds:50));
    expect(c.segments,isEmpty); await c.stop();
  });

  test('authorization failure preserves final recognition without an earlier partial', () async {
    final calls=<String>[], asr=_Asr(calls), license=_License(calls);
    final dir=Directory.systemTemp.createTempSync('v10-final-source-');
    addTearDown(() => dir.deleteSync(recursive:true));
    final c=RealtimeController(config:config(),
      repository:LocalRealtimeRepository(store:LocalSessionStore(file:File('${dir.path}/r.json')),license:license),
      mobileAsrProvider:asr,mobileTranslationProvider:_DeniedTranslation(calls),
      speechOutputProvider:_Speech(calls),audioCapture:FakeAudioCapture());
    addTearDown(c.dispose); await c.start(); asr.emit('one','这是最终识别结果');
    await _until(() => c.status==RealtimeStatus.failed);
    expect(c.segments.single.sourceText,'这是最终识别结果');
  });

  test('unsafe placeholder output keeps source and never retries unprotected', () async {
    final calls=<String>[], asr=_Asr(calls), license=_License(calls), mt=_UnsafeTranslation(calls);
    final dir=Directory.systemTemp.createTempSync('v10-unsafe-translation-');
    addTearDown(() => dir.deleteSync(recursive:true));
    final c=RealtimeController(config:config(),
      repository:LocalRealtimeRepository(store:LocalSessionStore(file:File('${dir.path}/r.json')),license:license),
      mobileAsrProvider:asr,mobileTranslationProvider:mt,
      speechOutputProvider:_Speech(calls),audioCapture:FakeAudioCapture());
    addTearDown(c.dispose); await c.start(); asr.emit('one','订单A120共947件');
    await _until(() => c.message?.contains('关键内容无法核实') == true);
    expect(c.status,RealtimeStatus.active); expect(mt.calls,1);
    expect(c.segments.single.sourceText,'订单A120共947件');
    expect(c.segments.single.translatedText,isEmpty); await c.stop();
  });

  test('completed recognition is checkpointed before normal end', () async {
    final calls=<String>[], asr=_Asr(calls), license=_License(calls);
    final dir=Directory.systemTemp.createTempSync('v10-checkpoint-');
    addTearDown(() => dir.deleteSync(recursive:true));
    final store=LocalSessionStore(file:File('${dir.path}/r.json'));
    final c=RealtimeController(config:config(),repository:LocalRealtimeRepository(store:store,license:license),
      mobileAsrProvider:asr,mobileTranslationProvider:_Translation(calls),
      speechOutputProvider:_Speech(calls),audioCapture:FakeAudioCapture());
    addTearDown(c.dispose);await c.start();asr.emit('one','本机保存的原文');
    await _untilAsync(() async => (await store.listSessions()).isNotEmpty);
    final snapshot=(await store.listSessions()).single;
    expect(snapshot.status,'recoverable');
    expect((await store.getSession(snapshot.sessionId)).segments.single.sourceText,'本机保存的原文');
    await c.stop();expect((await store.listSessions()).single.status,'ended');
  });

  test('failed final save keeps the record and blocks a new session until retry succeeds', () async {
    final calls=<String>[], asr=_Asr(calls), license=_License(calls);
    final dir=Directory.systemTemp.createTempSync('v10-save-retry-');
    addTearDown(() => dir.deleteSync(recursive:true));
    final store=_FailEndedStore(File('${dir.path}/r.json'));
    final c=RealtimeController(config:config(),repository:LocalRealtimeRepository(store:store,license:license),
      mobileAsrProvider:asr,mobileTranslationProvider:_Translation(calls),
      speechOutputProvider:_Speech(calls),audioCapture:FakeAudioCapture());
    addTearDown(c.dispose);await c.start();asr.emit('one','不能丢失的内容');
    await _untilAsync(() async => (await store.listSessions()).isNotEmpty);
    await c.stop();expect(c.status,RealtimeStatus.failed);expect(c.segments.single.sourceText,'不能丢失的内容');
    await c.start();expect(c.status,RealtimeStatus.failed);expect(c.segments.single.sourceText,'不能丢失的内容');
    store.fail=false;await c.start();expect(c.status,RealtimeStatus.active);
    expect((await store.listSessions()).single.status,'ended');await c.stop();
  });

  test('stalled translation does not block stop or discard the original', () async {
    final calls=<String>[], asr=_Asr(calls), license=_License(calls), mt=_BlockedTranslation(calls);
    final dir=Directory.systemTemp.createTempSync('v10-stop-deadline-');
    addTearDown(() => dir.deleteSync(recursive:true));
    final store=LocalSessionStore(file:File('${dir.path}/r.json'));
    final c=RealtimeController(config:config(),repository:LocalRealtimeRepository(store:store,license:license),
      mobileAsrProvider:asr,mobileTranslationProvider:mt,speechOutputProvider:_Speech(calls),
      audioCapture:FakeAudioCapture(),localTranslationDrainTimeout:const Duration(milliseconds:80));
    addTearDown(c.dispose);await c.start();asr.emit('one','等待翻译的原文');
    await _until(() => mt.calls==1);await c.stop().timeout(const Duration(seconds:2));
    expect(c.status,RealtimeStatus.ended);
    final session=(await store.listSessions()).single;
    expect((await store.getSession(session.sessionId)).segments.single.sourceText,'等待翻译的原文');
    mt.block.complete(const MobileTranslationResult(text:'late',provider:'fixture'));
    await Future<void>.delayed(const Duration(milliseconds:50));
    expect(c.segments.single.translatedText,isEmpty);
  });

  test('punctuated translation is read in order without dropping the tail', () async {
    final calls=<String>[],asr=_Asr(calls),license=_License(calls),speech=_Speech(calls);
    final dir=Directory.systemTemp.createTempSync('v10-speech-chunks-');
    addTearDown(() => dir.deleteSync(recursive:true));
    final c=RealtimeController(config:config(),
      repository:LocalRealtimeRepository(store:LocalSessionStore(file:File('${dir.path}/r.json')),license:license),
      mobileAsrProvider:asr,mobileTranslationProvider:_PunctuatedTranslation(calls),
      speechOutputProvider:speech,audioCapture:FakeAudioCapture(),autoSpeakTranslation:true);
    addTearDown(c.dispose);await c.start();asr.emit('one','请确认发货');
    await _until(() => speech.texts.isNotEmpty);expect(speech.texts.single,'First part.');
    speech.current!.complete();await _until(() => speech.texts.length==2);
    expect(speech.texts,['First part.','Second part.']);await c.stop();
  });
}

Future<void> _until(bool Function() ready) => _untilAsync(() async => ready());
Future<void> _untilAsync(Future<bool> Function() ready) async {
  final watch = Stopwatch()..start();
  while (!await ready()) {
    if (watch.elapsedMilliseconds > 2000) {
      fail('local lifecycle did not complete');
    }
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

class _License implements OnDeviceLicense {
  _License(this.calls);
  final List<String> calls;
  bool valid = true;
  int ensures = 0;
  final scopes = <String>{};
  final invalidationsController = StreamController<void>.broadcast();
  @override
  Stream<void> get invalidations => invalidationsController.stream;
  @override
  Future<DeviceLicenseSnapshot> ensureValid() async {
    ensures++;
    calls.add('license.ensure');
    return DeviceLicenseSnapshot({
      'valid': valid,
      'leaseId': 'fixture-verified-lease',
      'remainingMs': 1800000,
    });
  }

  @override
  Future<void> activity(String s, bool active) async {
    active ? scopes.add(s) : scopes.remove(s);
  }
}

class _Asr
    implements MobileAsrProvider, MobileAsrDiagnostics, MobileAsrPreparation {
  _Asr(this.calls);
  final List<String> calls;
  bool ready = true;
  final controller = StreamController<AsrTextSegment>.broadcast();
  void emit(String id, String text) =>
      controller.add(AsrTextSegment(id: id, text: text, language: 'zh'));
  @override
  Stream<AsrTextSegment> get segments => controller.stream;
  @override
  Future<MobileAsrAvailability> availability(MobileAsrConfig c) async =>
      MobileAsrAvailability(
        canStart: ready,
        reason: ready ? 'ready' : 'resource_missing',
        message: 'fixture resource status',
      );
  @override
  Future<void> prepare(MobileAsrConfig c) async {
    calls.add('asr.prepare');
  }

  @override
  Future<void> requestPermission() async {
    calls.add('asr.permission');
  }

  @override
  Future<void> start(MobileAsrConfig c) async {
    calls.add('asr.start');
  }

  @override
  Future<void> stop() async {
    calls.add('asr.stop');
  }

  @override
  Future<void> dispose() async {
    await controller.close();
  }
}

class _Translation
    implements MobileTranslationProvider, MobileTranslationDiagnostics, MobileTranslationPreparation {
  _Translation(this.log);
  final List<String> log;
  int calls = 0;
  @override
  Future<void> warmUp(MobileTranslationConfig c) async { log.add('mt.warm'); }
  @override
  Future<MobileTranslationAvailability> availability(
    MobileTranslationConfig c,
  ) async {
    log.add('mt.ready');
    return MobileTranslationAvailability(
      available: true,
      provider: 'fixture',
      sourceLanguage: c.sourceLanguage,
      targetLanguage: c.targetLanguage,
      status: 'installed',
      reason: 'ready',
    );
  }

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig c,
  ) async {
    calls++;
    return MobileTranslationResult(
      text: 'Synthetic translation $calls',
      provider: 'fixture',
    );
  }

  @override
  Future<void> dispose() async {}
}

class _BlockedTranslation extends _Translation {
  _BlockedTranslation(super.log);
  final block=Completer<MobileTranslationResult?>();
  @override Future<MobileTranslationResult?> translate(String text, MobileTranslationConfig c) {
    calls++; return block.future;
  }
}

class _BlockedWarmTranslation extends _Translation implements MobileTranslationCancellation {
  _BlockedWarmTranslation(super.log);
  final warm=Completer<void>();
  @override Future<void> warmUp(MobileTranslationConfig c) { log.add('mt.warm'); return warm.future; }
  @override Future<void> cancelPending() async {
    log.add('mt.warm.cancel');
    if (!warm.isCompleted) warm.complete();
  }
}

class _FailEndedStore extends LocalSessionStore {
  _FailEndedStore(File file):super(file:file);
  bool fail=true;
  @override Future<void> saveEndedSession({required String sessionId,required DateTime createdAt,
      required List<SubtitleSegment> segments}) async {
    if (fail) throw const FileSystemException('synthetic save failure');
    await super.saveEndedSession(sessionId:sessionId,createdAt:createdAt,segments:segments);
  }
}

class _DeniedTranslation extends _Translation {
  _DeniedTranslation(super.log);
  @override Future<MobileTranslationResult?> translate(String text, MobileTranslationConfig c) async {
    throw PlatformException(code:'authorization_required');
  }
}

class _UnsafeTranslation extends _Translation {
  _UnsafeTranslation(super.log);
  @override Future<MobileTranslationResult?> translate(String text, MobileTranslationConfig c) async {
    calls++; return const MobileTranslationResult(
      text:'Order XTLKEEP0QXZ XTLKEEP0QXZ has XTLKEEP1QXZ units.', provider:'fixture');
  }
}

class _PunctuatedTranslation extends _Translation {
  _PunctuatedTranslation(super.log);
  @override Future<MobileTranslationResult?> translate(String text,MobileTranslationConfig c) async =>
      const MobileTranslationResult(text:'First part. Second part.',provider:'fixture');
}

class _Speech implements SpeechOutputProvider, SpeechOutputPreparation {
  _Speech(this.calls);
  final List<String> calls;
  final texts = <String>[];
  Completer<void>? current;
  @override
  Future<void> prepareVoice(String l) async {
    calls.add('tts.prepare.$l');
  }

  @override
  Future<SpeechOutputResult> speak({
    required String text,
    required String language,
  }) async {
    texts.add(text);
    calls.add('tts.begin.${texts.length}');
    if (texts.length == 1) {
      current = Completer<void>();
      await current!.future;
    }
    return SpeechOutputResult(provider: 'fixture', language: language);
  }

  @override
  Future<void> stop() async {
    calls.add('tts.stop');
    final c = current;
    current = null;
    if (c != null && !c.isCompleted) c.complete();
  }
}
