import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/device_asr/presentation/widgets/core_ml_nemotron_audio_stats_rows.dart';

void main() {
  testWidgets('shows localized Core ML Nemotron audio input stats',
      (WidgetTester tester) async {
    await tester.pumpWidget(const _AudioStatsTestApp());

    expect(find.text('音频输入统计'), findsOneWidget);
    expect(find.text('输入缓冲数'), findsOneWidget);
    expect(find.text('转换采样数'), findsOneWidget);
    expect(find.text('转换失败次数'), findsOneWidget);
    expect(find.text('浮点采样提取失败'), findsOneWidget);
    expect(find.text('ASR 音频块数'), findsOneWidget);
    expect(find.text('已刷新尾段采样'), findsOneWidget);
    expect(find.text('最近转换错误'), findsOneWidget);
    expect(find.text('最近音量 RMS'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
    expect(find.text('67200'), findsOneWidget);
    expect(find.text('0'), findsNWidgets(2));
    expect(find.text('3'), findsOneWidget);
    expect(find.text('1600'), findsOneWidget);
    expect(find.text('无'), findsOneWidget);
    expect(find.text('0.1257'), findsOneWidget);
    expect(find.text('提示'), findsNothing);
  });

  testWidgets('shows no microphone input hint', (WidgetTester tester) async {
    await tester.pumpWidget(const _AudioStatsTestApp(
      details: <String, Object?>{
        'fluidAudio': <String, Object?>{
          'audio': <String, Object?>{
            'inputBuffers': 0,
            'convertedSamples': 0,
            'emittedChunks': 0,
          },
        },
      },
    ));

    expect(find.text('提示'), findsOneWidget);
    expect(find.textContaining('未收到麦克风输入'), findsOneWidget);
  });

  testWidgets('shows required voice processing state and failure hint',
      (WidgetTester tester) async {
    await tester.pumpWidget(const _AudioStatsTestApp(
      details: <String, Object?>{
        'fluidAudio': <String, Object?>{
          'audio': <String, Object?>{
            'voiceProcessingPolicy': 'apple_voice_processing_aec_ns',
            'voiceProcessingAttempted': true,
            'lastVoiceProcessingEnabled': false,
            'lastVoiceProcessingAgcEnabled': false,
            'voiceProcessingError': 'Voice processing did not become active',
            'inputBuffers': 0,
          },
        },
      },
    ));

    expect(find.text('语音处理策略'), findsOneWidget);
    expect(find.text('回声消除与系统降噪'), findsOneWidget);
    expect(find.text('自动增益 AGC'), findsOneWidget);
    expect(find.text('语音处理错误'), findsOneWidget);
    expect(find.textContaining('Apple 语音处理未启用'), findsOneWidget);
    expect(find.textContaining('未收到麦克风输入'), findsNothing);
  });

  testWidgets('shows audio session error before microphone hint',
      (WidgetTester tester) async {
    await tester.pumpWidget(const _AudioStatsTestApp(
      details: <String, Object?>{
        'fluidAudio': <String, Object?>{
          'audio': <String, Object?>{
            'sessionActive': false,
            'sessionError': 'AVAudioSession activation failed',
            'inputBuffers': 0,
            'convertedSamples': 0,
            'emittedChunks': 0,
          },
        },
      },
    ));

    expect(find.text('音频会话'), findsOneWidget);
    expect(find.text('音频会话错误'), findsOneWidget);
    expect(find.text('AVAudioSession activation failed'), findsOneWidget);
    expect(find.textContaining('iOS 音频会话启动失败'), findsOneWidget);
    expect(find.textContaining('未收到麦克风输入'), findsNothing);
  });

  testWidgets('shows no ASR chunk hint', (WidgetTester tester) async {
    await tester.pumpWidget(const _AudioStatsTestApp(
      details: <String, Object?>{
        'audio': <String, Object?>{
          'inputBuffers': 3,
          'convertedSamples': 22400,
          'conversionFailures': 0,
          'floatExtractionFailures': 0,
          'emittedChunks': 0,
        },
      },
    ));

    expect(find.textContaining('尚未形成 ASR 音频块'), findsOneWidget);
  });

  testWidgets('shows ASR processing error hint', (WidgetTester tester) async {
    await tester.pumpWidget(const _AudioStatsTestApp(
      details: <String, Object?>{
        'fluidAudio': <String, Object?>{
          'processingError': 'FluidAudio process failed',
          'audio': <String, Object?>{
            'inputBuffers': 3,
            'convertedSamples': 22400,
            'emittedChunks': 0,
          },
        },
      },
    ));

    expect(find.text('ASR 处理错误'), findsOneWidget);
    expect(find.text('FluidAudio process failed'), findsOneWidget);
    expect(find.textContaining('ASR 模型处理音频失败'), findsOneWidget);
    expect(find.textContaining('尚未形成 ASR 音频块'), findsNothing);
  });

  testWidgets('shows audio conversion failure hint',
      (WidgetTester tester) async {
    await tester.pumpWidget(const _AudioStatsTestApp(
      details: <String, Object?>{
        'audio': <String, Object?>{
          'inputBuffers': 2,
          'convertedSamples': 0,
          'conversionFailures': 1,
          'floatExtractionFailures': 0,
          'lastConversionError': 'converter_unavailable',
        },
      },
    ));

    expect(find.text('转换失败次数'), findsOneWidget);
    expect(find.text('最近转换错误'), findsOneWidget);
    expect(find.text('转换器不可用'), findsOneWidget);
    expect(find.textContaining('iOS 音频格式转换失败'), findsOneWidget);
  });
}

class _AudioStatsTestApp extends StatelessWidget {
  const _AudioStatsTestApp({
    this.details = const <String, Object?>{
      'fluidAudio': <String, Object?>{
        'audio': <String, Object?>{
          'inputBuffers': 4,
          'convertedSamples': 67200,
          'conversionFailures': 0,
          'floatExtractionFailures': 0,
          'emittedChunks': 3,
          'flushedTailSamples': 1600,
          'lastConversionError': 'none',
          'lastChunkRms': 0.12567,
        },
      },
    },
  });

  final Map<String, Object?> details;

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
      home: Scaffold(
        body: AudioStatsRows(
          details: details,
        ),
      ),
    );
  }
}
