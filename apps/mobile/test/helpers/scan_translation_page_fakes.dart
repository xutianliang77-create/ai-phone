part of '../scan_translation_page_test.dart';

AppConfig _localConfig() => AppConfig(
      apiBaseUrl: Uri.parse('https://api.example.cn'),
      useMockAudio: false,
      useDeviceAsr: true,
      deviceAsrProvider: 'apple_speech_transcriber',
      deviceAsrLanguage: 'zh',
      deviceAsrAutoDownloadModel: false,
      deviceAsrModelChunkMs: 32,
      serverOwnedHistory: false,
      useLocalSessions: true,
      useOnDeviceTranslation: true,
      sourceLanguage: 'zh',
      targetLanguage: 'en',
    );

PickedScanImage _picked(String path) {
  return PickedScanImage(
    path: path,
    previewBytes: base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ),
  );
}

class _TestApp extends StatelessWidget {
  const _TestApp({required this.child, this.textScale = 1});

  final Widget child;
  final double textScale;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
        ),
        child: child!,
      ),
      home: child,
    );
  }
}

class _FakeOcrProvider implements MobileOcrProvider {
  const _FakeOcrProvider(this.text);

  final String text;

  @override
  Future<void> dispose() async {}

  @override
  Future<MobileOcrResult?> recognizeImage(
    String imagePath, {
    List<String>? preferredScripts,
  }) async {
    return MobileOcrResult(
      text: text,
      provider: 'fake',
      blocks: text.isEmpty
          ? const <MobileOcrBlock>[]
          : <MobileOcrBlock>[
              MobileOcrBlock(
                text: text,
                left: 0.1,
                top: 0.2,
                width: 0.5,
                height: 0.2,
              ),
            ],
    );
  }
}

class _FakeTranslationProvider implements MobileTranslationProvider {
  _FakeTranslationProvider({this.fail = false});

  final bool fail;

  @override
  Future<void> dispose() async {}

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    if (fail) throw StateError('translation provider offline');
    if (text == '你好') {
      return const MobileTranslationResult(text: 'Hello', provider: 'fake');
    }
    return null;
  }
}

class _FakeSessionHistoryRepository extends SessionHistoryRepository {
  _FakeSessionHistoryRepository()
      : super(shareService: _FakeFileShareService());

  String? savedSourceText;
  String? savedTranslatedText;
  String? savedSourceLanguage;
  String? savedTargetLanguage;
  String? savedSourceKind;

  @override
  Future<SessionDetail> saveTextTranslationSession({
    required String sourceText,
    required String translatedText,
    required String sourceLanguage,
    required String targetLanguage,
    required String sourceKind,
  }) async {
    savedSourceText = sourceText;
    savedTranslatedText = translatedText;
    savedSourceLanguage = sourceLanguage;
    savedTargetLanguage = targetLanguage;
    savedSourceKind = sourceKind;
    return SessionDetail(
      sessionId: 'scan_1',
      mode: 'conversation',
      status: 'ended',
      consumedSeconds: 0,
      createdAt: DateTime.utc(2026, 7, 5),
      endedAt: DateTime.utc(2026, 7, 5),
      segmentCount: 1,
      segments: <SessionSegment>[
        SessionSegment(
          id: 'scan_1',
          sourceText: sourceText,
          translatedText: translatedText,
        ),
      ],
    );
  }
}

class _FakeFileShareService implements FileShareService {
  @override
  Future<String> saveExportFile(List<int> bytes, String filename) async {
    return filename;
  }

  @override
  Future<void> shareFile(String path, {String? mimeType}) async {}
}
