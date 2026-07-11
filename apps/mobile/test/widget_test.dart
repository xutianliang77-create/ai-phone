import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:translation_mobile/src/app/app.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/compliance/data/compliance_consent_store.dart';
import 'package:translation_mobile/src/features/compliance/data/consent_audit_uploader.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/realtime_status_bar.dart';

void main() {
  testWidgets('shows Chinese realtime interpreter home',
      (WidgetTester tester) async {
    await pumpAcceptedApp(tester);

    expect(find.text('ai phone'), findsOneWidget);
    expect(find.byTooltip('语言'), findsOneWidget);
    expect(find.text('开始'), findsOneWidget);
    expect(find.text('暂停'), findsNothing);
    expect(find.text('结束'), findsNothing);
    expect(find.text('同传'), findsOneWidget);
    expect(find.text('通话'), findsOneWidget);
    expect(find.text('扫描'), findsOneWidget);
    expect(find.text('记录'), findsOneWidget);
    expect(find.text('我的'), findsOneWidget);
  });

  testWidgets('falls back to Chinese for unsupported system locale',
      (WidgetTester tester) async {
    final platformDispatcher = tester.binding.platformDispatcher;
    platformDispatcher.localeTestValue = const Locale('ja');
    platformDispatcher.localesTestValue = const <Locale>[Locale('ja')];
    addTearDown(() {
      platformDispatcher.clearLocaleTestValue();
      platformDispatcher.clearLocalesTestValue();
    });

    await pumpAcceptedApp(tester, locale: null);

    expect(find.text('ai phone'), findsOneWidget);
    expect(find.byTooltip('语言'), findsOneWidget);
    expect(find.text('点击开始进行同传'), findsOneWidget);
  });

  testWidgets('can render English interface', (WidgetTester tester) async {
    await pumpAcceptedApp(tester, locale: const Locale('en'));

    expect(find.text('ai phone'), findsOneWidget);
    expect(find.text('Start'), findsOneWidget);
    expect(find.text('Pause'), findsNothing);
    expect(find.text('End'), findsNothing);
  });

  testWidgets('switches interface language from home toolbar',
      (WidgetTester tester) async {
    await pumpAcceptedApp(tester);

    await tester.tap(find.byTooltip('语言'));
    await tester.pumpAndSettle();
    expect(find.text('英文'), findsOneWidget);
    await tester.tap(find.text('英文').last);
    await tester.pumpAndSettle();

    expect(find.text('ai phone'), findsOneWidget);
    expect(find.text('Start'), findsOneWidget);
    expect(find.text('Pause'), findsNothing);
    expect(find.text('End'), findsNothing);
    expect(find.byTooltip('Language'), findsOneWidget);
  });

  testWidgets('shows domestic call entry policy', (WidgetTester tester) async {
    await pumpAcceptedApp(tester);

    await tester.tap(find.text('通话'));
    await tester.pumpAndSettle();

    expect(find.text('国内版 · 中英优先 · PSTN 暂未开放'), findsOneWidget);
    expect(find.text('发起翻译电话'), findsOneWidget);
    expect(find.text('输入并朗读'), findsOneWidget);
    expect(find.text('拨打手机号'), findsOneWidget);
    expect(find.text('AI 代打电话'), findsOneWidget);
    expect(find.text('加入通话链接'), findsOneWidget);
  });

  testWidgets('opens compliance center from me tab', (tester) async {
    await pumpAcceptedApp(tester);

    await tester.tap(find.text('我的'));
    await tester.pumpAndSettle();
    expect(find.text('账号与登录'), findsOneWidget);
    await tester.tap(find.text('隐私与合规'));
    await tester.pumpAndSettle();

    expect(find.text('隐私政策'), findsOneWidget);
    expect(find.text('用户协议'), findsOneWidget);
    expect(find.text('第三方 SDK 与模型服务商清单'), findsOneWidget);
  });

  testWidgets('opens type-to-speak from domestic call entry',
      (WidgetTester tester) async {
    await pumpAcceptedApp(tester);

    await tester.tap(find.text('通话'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('输入并朗读'));
    await tester.pumpAndSettle();

    expect(find.text('输入内容'), findsOneWidget);
    expect(find.text('暂无译文'), findsOneWidget);
  });

  testWidgets('opens AI Calling Agent from domestic call entry',
      (WidgetTester tester) async {
    await pumpAcceptedApp(tester);

    await tester.tap(find.text('通话'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AI 代打电话'));
    await tester.pumpAndSettle();

    expect(find.text('先生成话术草稿，用户确认授权后才进入拨号队列。'), findsOneWidget);
    expect(find.text('生成话术草稿'), findsOneWidget);
  });

  testWidgets('blocks app shell until initial compliance consent is accepted',
      (WidgetTester tester) async {
    final store = MemoryComplianceConsentStore();
    final uploader = _FakeConsentAuditUploader();
    await tester.pumpWidget(TranslationApp(
      complianceConsentStore: store,
      consentAuditUploader: uploader,
    ));
    await tester.pumpAndSettle();

    expect(find.text('首次使用前请确认'), findsOneWidget);
    expect(find.text('同意并继续'), findsOneWidget);
    expect(find.text('开始'), findsNothing);

    final acceptButton = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, '同意并继续'),
    );
    expect(acceptButton.onPressed, isNull);

    await tester.tap(find.textContaining('我已阅读并同意'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '同意并继续'));
    await tester.pumpAndSettle();

    expect(store.record?.version, complianceConsentVersion);
    expect(uploader.records.single.consentType, 'initial_privacy');
    expect(uploader.records.single.scene, 'app_start');
    expect(find.text('ai phone'), findsOneWidget);
    expect(find.text('开始'), findsOneWidget);
  });

  testWidgets('localizes realtime status bar API errors',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
      locale: Locale('zh'),
      localizationsDelegates: <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: RealtimeStatusBar(
          status: RealtimeStatus.ended,
          message: 'End session failed: {}',
        ),
      ),
    ));

    expect(find.text('结束会话失败'), findsOneWidget);
  });

  testWidgets('shows realtime low balance warning in Chinese',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
      locale: Locale('zh'),
      localizationsDelegates: <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: RealtimeStatusBar(
          status: RealtimeStatus.active,
          remainingSeconds: 15,
          lowBalance: true,
        ),
      ),
    ));

    expect(find.textContaining('状态：同传中'), findsOneWidget);
    expect(find.textContaining('在线同传剩余 15 秒'), findsOneWidget);
  });

  testWidgets('keeps low balance warning visible with latest error summary',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
      locale: Locale('zh'),
      localizationsDelegates: <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: RealtimeStatusBar(
          status: RealtimeStatus.ended,
          message: 'End session failed: {}',
          remainingSeconds: 8,
          lowBalance: true,
        ),
      ),
    ));

    expect(find.textContaining('结束会话失败'), findsOneWidget);
    expect(find.textContaining('在线同传剩余 8 秒'), findsOneWidget);
  });

  test('localizes diagnostic values and user-facing errors', () {
    const zh = AppLocalizations(Locale('zh'));
    const en = AppLocalizations(Locale('en'));

    expect(zh.diagnosticsValue('model_not_found'), '模型未找到');
    expect(zh.diagnosticsLabel('microphone.permission'), '麦克风权限');
    expect(zh.diagnosticsLabel('preparedModelReady'), '已加载模型');
    expect(zh.diagnosticsLabel('modelScan.candidateCount'), '候选路径数');
    expect(zh.diagnosticsLabel('audio.conversionFailures'), '转换失败次数');
    expect(zh.diagnosticsLabel('audio.emittedChunks'), 'ASR 音频块数');
    expect(zh.diagnosticsLabel('audio.flushedTailSamples'), '已刷新尾段采样');
    expect(zh.diagnosticsLabel('audio.lastConversionError'), '最近转换错误');
    expect(zh.diagnosticsValue('denied'), '已拒绝');
    expect(zh.diagnosticsValue('downloaded_or_cached'), '已下载或已缓存');
    expect(zh.diagnosticsValue('model_incomplete'), '模型不完整');
    expect(zh.diagnosticsValue('api'), 'API 历史同步');
    expect(zh.diagnosticsValue('mock'), '模拟服务');
    expect(zh.diagnosticsValue('none'), '无');
    expect(zh.diagnosticsValue('no_microphone_input'), '未收到麦克风输入');
    expect(zh.diagnosticsValue('asr_processing_error'), 'ASR 处理错误');
    expect(zh.audioSessionErrorHint, contains('iOS 音频会话启动失败'));
    expect(
      zh.errorMessage(Exception('Create session failed: {}')),
      '创建实时会话失败',
    );
    expect(
      zh.runtimeMessage('Device ASR is unavailable: model_not_found'),
      '端侧 ASR 当前不可用：模型未找到',
    );
    expect(en.diagnosticsValue('model_not_found'), 'model_not_found');
  });

  test('keeps runtime and diagnostics messages Chinese by default', () {
    const zh = AppLocalizations(Locale('zh'));

    expect(zh.runtimeMessage('Preparing device ASR model'), '正在准备端侧 ASR 模型');
    expect(
      zh.runtimeMessage('Device ASR model ready. Connecting realtime session'),
      '端侧 ASR 模型已就绪，正在连接实时会话',
    );
    expect(
      zh.runtimeMessage('Device ASR model ready. Starting local session'),
      '端侧 ASR 模型已就绪，正在启动本地会话',
    );
    expect(zh.runtimeMessage('Realtime connection lost'), '实时连接已断开');
    expect(zh.runtimeMessage('Realtime connection restored'), '实时连接已恢复');
    expect(zh.runtimeMessage('Reconnecting (2/3)'), '正在重连 (2/3)');
    expect(zh.runtimeMessage('Session time limit reached'), '本次会话已达到时长上限');
    expect(zh.runtimeMessage('Diagnostics report ready'), '诊断报告已生成');
    expect(
      zh.runtimeMessage('On-device translation unavailable'),
      '端侧翻译暂不可用',
    );
    expect(
      zh.runtimeMessage(
        'Bad state: device ASR start failed; '
        'Device ASR processing failed: FluidAudio process failed',
      ),
      '端侧 ASR 启动失败；ASR 模型处理音频失败',
    );
    expect(
      zh.runtimeMessage(
        'device ASR start failed; Device ASR diagnostic: no_microphone_input',
      ),
      '端侧 ASR 启动失败；端侧 ASR 诊断：未收到麦克风输入',
    );
    expect(
      zh.runtimeMessage(
          'Device ASR is unavailable: microphone_permission_denied'),
      '端侧 ASR 当前不可用：麦克风权限已拒绝',
    );
    expect(
      zh.errorMessage(Exception('ClientException: failed host lookup')),
      '网络连接失败，请检查 API 服务是否可用',
    );
  });
}

Future<void> pumpAcceptedApp(
  WidgetTester tester, {
  Locale? locale = const Locale('zh'),
}) async {
  await tester.pumpWidget(TranslationApp(
    locale: locale,
    complianceConsentStore: MemoryComplianceConsentStore.accepted(),
  ));
  await tester.pump();
}

class _FakeConsentAuditUploader implements ConsentAuditUploader {
  final records = <({String consentType, String scene})>[];

  @override
  Future<void> record({
    required String consentType,
    required String version,
    required String scene,
    required Locale locale,
    String? acceptedAtIso,
  }) async {
    records.add((consentType: consentType, scene: scene));
  }
}
