import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/voice_profile/data/voice_profile_api_client.dart';
import 'package:translation_mobile/src/features/voice_profile/data/voice_reference_recorder.dart';
import 'package:translation_mobile/src/features/voice_profile/presentation/pages/my_voice_page.dart';
import 'package:translation_mobile/src/platform/diagnostics/app_error_reporter.dart';
import 'package:translation_mobile/src/platform/speech/pcm_audio_output_player.dart';

import 'widget_test.dart';

void main() {
  testWidgets('opens my voice from me tab', (tester) async {
    await pumpAcceptedApp(tester);

    await tester.tap(find.text('我的'));
    await tester.pumpAndSettle();
    expect(find.text('我的声音'), findsOneWidget);
    await tester.tap(find.text('我的声音'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('声音档案'), findsOneWidget);
    expect(find.text('未创建'), findsOneWidget);
    expect(find.text('VoxCPM2 自然声音'), findsOneWidget);
    expect(find.text('创建我的声音'), findsOneWidget);
  });

  testWidgets('creates and deletes my voice profile', (tester) async {
    final client = _FakeVoiceProfileClient();
    await tester.pumpWidget(MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: MyVoicePage(client: client),
    ));
    await tester.pumpAndSettle();

    expect(find.text('未创建'), findsOneWidget);
    await tester.tap(find.text('创建我的声音'));
    await tester.pumpAndSettle();

    expect(find.text('声音档案已创建'), findsOneWidget);
    expect(find.text('待录制参考音频'), findsOneWidget);
    await tester.ensureVisible(find.text('删除声音档案'));
    await tester.drag(find.byType(ListView), const Offset(0, -120));
    await tester.pumpAndSettle();
    await tester.tap(find.text('删除声音档案'));
    await tester.pumpAndSettle();

    expect(find.text('声音档案已删除'), findsOneWidget);
    expect(find.text('未创建'), findsOneWidget);
  });

  testWidgets('records and uploads my voice reference audio', (tester) async {
    final client = _FakeVoiceProfileClient();
    final recorder = _FakeVoiceReferenceRecorder();
    final audioPlayer = _FakePcmAudioOutputPlayer();
    await tester.pumpWidget(MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: MyVoicePage(
        client: client,
        recorder: recorder,
        audioPlayer: audioPlayer,
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('创建我的声音'));
    await tester.pumpAndSettle();
    expect(find.text('待录制参考音频'), findsOneWidget);

    await tester.tap(find.text('开始录音'));
    await tester.pumpAndSettle();
    expect(find.text('录音中'), findsWidgets);

    await tester.tap(find.text('停止并上传'));
    await tester.pumpAndSettle();

    expect(find.text('参考音频已上传'), findsOneWidget);
    expect(find.text('VoxCPM2 我的声音'), findsOneWidget);
    expect(
      client.uploadedReferenceTranscript,
      '你好，我正在创建我的声音，用于翻译后的语音播报。',
    );

    expect(find.text('试听自然声音'), findsOneWidget);
    await tester.tap(find.text('试听我的声音'));
    await tester.pumpAndSettle();

    expect(find.text('试听完成。如果不像你的声音，请重新录制。'), findsOneWidget);
    expect(client.testVoiceCalled, isTrue);
    expect(audioPlayer.playedData, 'AA==');
  });

  testWidgets('shows microphone permission failure while recording',
      (tester) async {
    final client = _FakeVoiceProfileClient();
    final recorder = _FakeVoiceReferenceRecorder(
      startError:
          const VoiceReferenceRecorderException('microphone_permission_denied'),
    );
    await tester.pumpWidget(MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: MyVoicePage(
        client: client,
        recorder: recorder,
        errorReporter: _disabledErrorReporter(),
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('创建我的声音'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('开始录音'));
    await tester.pumpAndSettle();

    expect(find.text('麦克风权限被拒绝，请到系统设置中允许无界AI使用麦克风。'), findsOneWidget);
  });
}

class _FakeVoiceProfileClient implements VoiceProfileClient {
  VoiceProfile? _profile;

  @override
  Future<VoiceProfile?> fetchMyProfile() async => _profile;

  @override
  Future<VoiceProfile> createMyProfile({
    required String consentVersion,
    required DateTime consentAcceptedAt,
  }) async {
    return _profile = VoiceProfile(
      id: 'voice-profile-1',
      displayName: '我的声音',
      status: 'pending_reference_audio',
      voiceMode: 'personal_clone',
      createdAt: consentAcceptedAt,
      updatedAt: consentAcceptedAt,
    );
  }

  @override
  Future<VoiceProfile> uploadReferenceAudio({
    required String audioBase64,
    required int durationMs,
    required String referenceTranscript,
    String mimeType = 'audio/wav',
  }) async {
    uploadedReferenceTranscript = referenceTranscript;
    return _profile = VoiceProfile(
      id: _profile?.id ?? 'voice-profile-1',
      displayName: _profile?.displayName ?? '我的声音',
      status: 'ready',
      voiceMode: 'ultimate_clone',
      createdAt: _profile?.createdAt ?? DateTime.now(),
      updatedAt: DateTime.now(),
      referenceAudioId: 'voice-reference-1',
    );
  }

  @override
  Future<VoiceProfileTestAudio> testMyVoice({
    String language = 'zh',
    String? text,
    String variant = 'clone',
  }) async {
    testVoiceCalled = true;
    return const VoiceProfileTestAudio(
      text: '你好，这是我的声音试听。',
      language: 'zh',
      provider: 'voxcpm2',
      model: 'VoxCPM2',
      voiceMode: 'ultimate_clone',
      audio: VoiceProfileAudioPayload(sampleRate: 24000, data: 'AA=='),
    );
  }

  @override
  Future<VoiceProfile> deleteMyProfile() async {
    final deleted = VoiceProfile(
      id: _profile?.id ?? 'voice-profile-1',
      displayName: _profile?.displayName ?? '我的声音',
      status: 'deleted',
      voiceMode: 'personal_clone',
      createdAt: _profile?.createdAt ?? DateTime.now(),
      updatedAt: DateTime.now(),
    );
    _profile = null;
    return deleted;
  }

  String uploadedReferenceTranscript = '';
  bool testVoiceCalled = false;
}

class _FakeVoiceReferenceRecorder implements VoiceReferenceRecorder {
  _FakeVoiceReferenceRecorder({this.startError});

  final Object? startError;
  bool started = false;

  @override
  Future<void> start() async {
    final startError = this.startError;
    if (startError != null) throw startError;
    started = true;
  }

  @override
  Future<VoiceReferenceRecording> stop() async {
    started = false;
    return const VoiceReferenceRecording(
      bytes: <int>[82, 73, 70, 70, 1, 2, 3, 4, 87, 65, 86, 69],
      durationMs: 5000,
    );
  }

  @override
  Future<void> dispose() async {}
}

class _FakePcmAudioOutputPlayer implements PcmAudioOutputPlayer {
  String? playedData;

  @override
  Future<PcmAudioOutputResult> play({
    required String data,
    required int sampleRate,
  }) async {
    playedData = data;
    return PcmAudioOutputResult(
      provider: 'fake',
      sampleRate: sampleRate,
    );
  }

  @override
  Future<void> stop() async {}
}

AppErrorReporter _disabledErrorReporter() {
  return AppErrorReporter(
    baseUrl: Uri.parse('http://127.0.0.1:3100'),
    enabled: false,
    appVersion: 'test',
    buildNumber: 'test',
    regionEdition: 'domestic',
    dataRegion: 'cn',
  );
}
