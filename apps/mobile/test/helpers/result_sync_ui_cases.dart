part of '../result_sync_sender_test.dart';

void resultSyncUiCases() {
  testWidgets(
      'original realtime page requires text consent and never sends on allow alone',
      (tester) async {
    final h = _Harness();
    final config = AppConfig(
        apiBaseUrl: Uri.parse('https://sync.test'),
        useMockAudio: false,
        useDeviceAsr: false,
        useLocalSessions: false,
        useOnDeviceTranslation: false,
        deviceAsrProvider: 'apple_speech_transcriber',
        deviceAsrLanguage: 'zh',
        deviceAsrAutoDownloadModel: false,
        deviceAsrModelChunkMs: 32,
        serverOwnedHistory: true,
        sourceLanguage: 'zh',
        targetLanguage: 'en');
    final controller = RealtimeController(
        repository: h.repo, config: config, audioCapture: _NoCapture());
    final voices = _NoVoices();
    await controller.start();
    expect(controller.status, RealtimeStatus.active);
    expect(controller.resultSyncAvailable, isTrue);
    await tester.pumpWidget(MaterialApp(
        locale: const Locale('zh'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate
        ],
        home: AppLanguageScope(
            locale: const Locale('zh'),
            onChanged: (_) {},
            child: RealtimePage(
                config: config,
                settingsStore: MemoryRealtimeSettingsStore(),
                accountSessionStore: h.accounts,
                voicePresetClient: voices,
                controllerFactory: (_) => controller))));
    await _pumpSyncUi(tester);
    expect(find.text('允许本会话同步'), findsOneWidget);
    await tester.tap(find.text('允许本会话同步'));
    await _pumpSyncUi(tester);
    expect(find.text('本会话原译文同步'), findsOneWidget);
    expect(find.textContaining('不上传音频'), findsOneWidget);
    expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, '同意并继续'))
            .onPressed,
        isNull);
    expect(h.requests, isEmpty);
    await tester.tap(find.text('取消'));
    await _pumpSyncUi(tester);
    expect(h.requests, isEmpty);
    await tester.tap(find.text('允许本会话同步'));
    await _pumpSyncUi(tester);
    await tester.tap(find.byType(CheckboxListTile));
    await _pumpSyncUi(tester);
    await tester.tap(find.text('同意并继续'));
    await _pumpSyncUi(tester);
    expect(h.allowed, isTrue);
    expect(h.syncBodies, isEmpty);
    expect(find.text('同步一次'), findsOneWidget);
    expect(find.text('撤销同步'), findsOneWidget);
    await _drainSyncUi(tester,controller.stop());
    await _pumpSyncUi(tester);
    expect(find.text('确认待结束会话'),findsOneWidget);
    await tester.tap(find.text('确认待结束会话'));
    for(var i=0;i<60&&controller.resultSyncBusy;i++){
      await tester.runAsync(()=>Future<void>.delayed(const Duration(milliseconds:10)));
      await tester.pump(const Duration(milliseconds:100));
    }
    expect(controller.resultSyncBusy,isFalse);
    expect(find.textContaining('仍保留 1 项待确认'),findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    await _drainSyncUi(tester,controller.disposeAsync());
    voices.close();
    h.close();
  });
}

class _NoCapture implements AudioCapture {
  @override
  Stream<AudioFrame> get frames => const Stream.empty();
  @override
  Future<void> requestPermission() async {}
  @override
  Future<void> start(AudioCaptureConfig config) async {}
  @override
  Future<void> pause() async {}
  @override
  Future<void> resume() async {}
  @override
  Future<void> stop() async {}
  @override
  Future<void> dispose() async {}
}

class _NoVoices extends VoicePresetClient {
  _NoVoices() : super(baseUrl: Uri.parse('https://sync.test'));
  @override
  Future<VoicePresetCatalog> load() async => const VoicePresetCatalog.empty();
}

Future<void> _pumpSyncUi(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _drainSyncUi(WidgetTester tester,Future<void> work) async {
  var done=false;Object? failure;
  work.then((_)=>done=true,onError:(Object error){failure=error;done=true;});
  for(var i=0;i<60&&!done;i++){
    await tester.runAsync(()=>Future<void>.delayed(const Duration(milliseconds:10)));
    await tester.pump(const Duration(milliseconds:100));
  }
  expect(done,isTrue,reason:'Owned asynchronous cleanup must finish');
  if(failure!=null)throw failure!;
}
