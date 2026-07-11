import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import 'app_localization_texts.dart';

class AppLocalizations {
  const AppLocalizations(this.locale);

  final Locale locale;

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  static const List<Locale> supportedLocales = <Locale>[
    Locale('zh'),
    Locale('en')
  ];

  static AppLocalizations of(BuildContext context) {
    final localizations =
        Localizations.of<AppLocalizations>(context, AppLocalizations);
    assert(localizations != null, 'AppLocalizations missing from context');
    return localizations!;
  }

  bool get isChinese => locale.languageCode.toLowerCase() == 'zh';

  String get appTitle => _text('appTitle');
  String get realtimeSubtitle => _text('realtimeSubtitle');
  String get history => _text('history');
  String get deviceAsrDiagnostics => _text('deviceAsrDiagnostics');
  String get refresh => _text('refresh');
  String get clear => _text('clear');
  String get search => _text('search');
  String get language => _text('language');
  String get chinese => _text('chinese');
  String get english => _text('english');
  String get translationDirection => _text('translationDirection');
  String get translateToChinese => _text('translateToChinese');
  String get translateToEnglish => _text('translateToEnglish');
  String get start => _text('start');
  String get pause => _text('pause');
  String get end => _text('end');
  String get tapStartToBegin => _text('tapStartToBegin');
  String get noSessionsYet => _text('noSessionsYet');
  String get noSavedSubtitles => _text('noSavedSubtitles');
  String get sessionDetail => _text('sessionDetail');
  String get export => _text('export');
  String get exportDiagnostics => _text('exportDiagnostics');
  String get diagnosticsReportReady => _text('diagnosticsReportReady');
  String get exportMarkdown => _text('exportMarkdown');
  String get exportText => _text('exportText');
  String get exportJson => _text('exportJson');
  String get exportCsv => _text('exportCsv');
  String get delete => _text('delete');
  String get open => _text('open');
  String get cancel => _text('cancel');
  String get prepareModel => _text('prepareModel');
  String get inspectModel => _text('inspectModel');
  String get checkService => _text('checkService');
  String get serviceConnection => _text('serviceConnection');
  String get onDeviceTranslation => _text('onDeviceTranslation');
  String get apiBaseUrl => _text('apiBaseUrl');
  String get apiHealthStatus => _text('apiHealthStatus');
  String get warning => _text('warning');
  String get localAddressWarning => _text('localAddressWarning');
  String get apiService => _text('apiService');
  String get serviceVersion => _text('serviceVersion');
  String get realtimeWsEndpoint => _text('realtimeWsEndpoint');
  String get gatewayHealthStatus => _text('gatewayHealthStatus');
  String get gatewayService => _text('gatewayService');
  String get gatewayProvider => _text('gatewayProvider');
  String get gatewayResolvedProvider => _text('gatewayResolvedProvider');
  String get gatewayAsrProvider => _text('gatewayAsrProvider');
  String get gatewaySessionEventSink => _text('gatewaySessionEventSink');
  String get notChecked => _text('notChecked');
  String get microphoneSelfTest => _text('microphoneSelfTest');
  String get startSelfTest => _text('startSelfTest');
  String get stopSelfTest => _text('stopSelfTest');
  String get selfTestResults => _text('selfTestResults');
  String get selfTestNoResult => _text('selfTestNoResult');
  String get audioInputStats => _text('audioInputStats');
  String get audioNoInputHint => _text('audioNoInputHint');
  String get audioNoConvertedSamplesHint =>
      _text('audioNoConvertedSamplesHint');
  String get audioConversionFailureHint => _text('audioConversionFailureHint');
  String get audioSessionErrorHint => _text('audioSessionErrorHint');
  String get asrProcessingErrorHint => _text('asrProcessingErrorHint');
  String get audioNoAsrChunksHint => _text('audioNoAsrChunksHint');
  String get finalResult => _text('finalResult');
  String get partialResult => _text('partialResult');
  String get allowModelDownload => _text('allowModelDownload');
  String get availability => _text('availability');
  String get nativeDetails => _text('nativeDetails');
  String get lastError => _text('lastError');
  String get ready => _text('ready');
  String get notReady => _text('notReady');
  String get yes => _text('yes');
  String get no => _text('no');
  String get unknown => _text('unknown');
  String get deleteSession => _text('deleteSession');
  String get deleteSessionBody => _text('deleteSessionBody');
  String get statusIdle => _text('statusIdle');
  String get statusConnecting => _text('statusConnecting');
  String get statusListening => _text('statusListening');
  String get statusPaused => _text('statusPaused');
  String get statusEnded => _text('statusEnded');
  String get tabLive => _text('tabLive');
  String get tabCall => _text('tabCall');
  String get tabLens => _text('tabLens');
  String get tabRecords => _text('tabRecords');
  String get tabMe => _text('tabMe');
  String get myVoiceTitle => _text('myVoiceTitle');
  String get myVoiceBody => _text('myVoiceBody');
  String get myVoiceProfile => _text('myVoiceProfile');
  String get myVoiceNotCreated => _text('myVoiceNotCreated');
  String get myVoiceCurrentOutput => _text('myVoiceCurrentOutput');
  String get myVoiceNaturalVoice => _text('myVoiceNaturalVoice');
  String get myVoicePersonalOutput => _text('myVoicePersonalOutput');
  String get myVoiceDataControl => _text('myVoiceDataControl');
  String get myVoiceConsentRequired => _text('myVoiceConsentRequired');
  String get myVoiceConsentRecorded => _text('myVoiceConsentRecorded');
  String get myVoicePendingReference => _text('myVoicePendingReference');
  String get myVoiceCreate => _text('myVoiceCreate');
  String get myVoiceDelete => _text('myVoiceDelete');
  String get myVoiceCreateSuccess => _text('myVoiceCreateSuccess');
  String get myVoiceDeleteSuccess => _text('myVoiceDeleteSuccess');
  String get myVoiceAuthRequired => _text('myVoiceAuthRequired');
  String get myVoiceLoadFailed => _text('myVoiceLoadFailed');
  String get scanTitle => _text('scanTitle');
  String get scanDomesticBody => _text('scanDomesticBody');
  String get scanCamera => _text('scanCamera');
  String get scanGallery => _text('scanGallery');
  String get scanPickImage => _text('scanPickImage');
  String get scanRecognizing => _text('scanRecognizing');
  String get scanImageSelected => _text('scanImageSelected');
  String get recognizedText => _text('recognizedText');
  String get dataRegion => _text('dataRegion');
  String get regionEdition => _text('regionEdition');
  String get callProviderPolicy => _text('callProviderPolicy');
  String get complianceProfile => _text('complianceProfile');
  String get modelProviders => _text('modelProviders');
  String get paymentStack => _text('paymentStack');
  String get domesticEditionStatus => _text('domesticEditionStatus');
  String get internationalEditionStatus => _text('internationalEditionStatus');
  String get typeToSpeak => _text('typeToSpeak');
  String get typeToSpeakBody => _text('typeToSpeakBody');
  String get typeToSpeakInput => _text('typeToSpeakInput');
  String get translate => _text('translate');
  String get speakTranslation => _text('speakTranslation');
  String get saveToHistory => _text('saveToHistory');
  String get stopSpeaking => _text('stopSpeaking');
  String get translatedText => _text('translatedText');
  String get typeToSpeakNoTranslation => _text('typeToSpeakNoTranslation');
  String get talkMode => _text('talkMode');
  String get listeningMode => _text('listeningMode');
  String get summary => _text('summary');
  String get highlights => _text('highlights');
  String get transcript => _text('transcript');
  String get terms => _text('terms');
  String get noHighlights => _text('noHighlights');
  String get noTerms => _text('noTerms');
  String get meetingMinutes => _text('meetingMinutes');
  String get meetingMinutesHint => _text('meetingMinutesHint');
  String get meetingMinutesReady => _text('meetingMinutesReady');
  String get generateReview => _text('generateReview');
  String get regenerateReview => _text('regenerateReview');
  String get reviewGenerated => _text('reviewGenerated');
  String get viewMeetingMinutes => _text('viewMeetingMinutes');
  String get walletTitle => _text('walletTitle');
  String get walletBody => _text('walletBody');
  String get usageBalance => _text('usageBalance');
  String get planProduct => _text('planProduct');
  String get purchaseSandbox => _text('purchaseSandbox');
  String get restorePurchases => _text('restorePurchases');
  String get paymentUnavailable => _text('paymentUnavailable');
  String get billingLedger => _text('billingLedger');
  String get noBillingLedger => _text('noBillingLedger');
  String get purchaseSuccess => _text('purchaseSuccess');
  String get purchaseFailed => _text('purchaseFailed');
  String get restoreSuccess => _text('restoreSuccess');
  String get restoreEmpty => _text('restoreEmpty');
  String get restoreFailed => _text('restoreFailed');

  String typeToSpeakStatusMessage(String code) => _text(code);

  String scanStatusMessage(String code) => _text(code);

  String text(String key) => _text(key);

  String statusLine(String status) {
    return isChinese ? '状态：$status' : 'Status: $status';
  }

  String realtimeLowBalanceWarning(int remainingSeconds) {
    final seconds = remainingSeconds.clamp(0, 999999);
    if (isChinese) {
      return '在线同传剩余 $seconds 秒，请及时充值或切回端侧';
    }
    return 'Online interpreting has $seconds seconds left. Top up or switch to on-device mode.';
  }

  String sessionSummary({
    required String status,
    required int consumedSeconds,
    required int segmentCount,
  }) {
    final localizedStatus = sessionStatus(status);
    if (isChinese) {
      return '$localizedStatus · $consumedSeconds 秒 · $segmentCount 段';
    }
    final segmentLabel = segmentCount == 1 ? 'segment' : 'segments';
    return '$localizedStatus · ${consumedSeconds}s · '
        '$segmentCount $segmentLabel';
  }

  String sessionStatus(String status) {
    if (!isChinese) return status;
    return switch (status) {
      'created' => '已创建',
      'active' => '进行中',
      'paused' => '已暂停',
      'ended' => '已结束',
      _ => status,
    };
  }

  String diagnosticsLabel(String key) {
    if (!isChinese) return key;
    return zhDiagnosticsLabels[key] ?? key;
  }

  String diagnosticsValue(String value) {
    if (!isChinese) return value;
    return zhDiagnosticsValues[value] ?? value;
  }

  String errorMessage(Object error) {
    final message = _stripErrorPrefix(error.toString());
    if (!isChinese) return message;
    if (message.startsWith('Create session failed')) {
      return '创建实时会话失败';
    }
    if (message.startsWith('Create room token failed')) {
      return '准备通话房间失败，请检查 LiveKit 配置';
    }
    if (message.startsWith('Connect call room failed')) {
      return '进入通话房间失败，请检查 LiveKit 服务';
    }
    if (message.startsWith('End call link failed')) {
      return '结束并保存通话失败';
    }
    if (message.startsWith('Save segments failed')) {
      return '保存字幕失败';
    }
    if (message.startsWith('End session failed')) {
      return '结束会话失败';
    }
    if (message.startsWith('API /health failed')) {
      return 'API 健康检查失败';
    }
    if (message.startsWith('Gateway /health failed')) {
      return '实时网关健康检查失败';
    }
    if (message.startsWith('ClientException')) {
      return '网络连接失败，请检查 API 服务是否可用';
    }
    return runtimeMessage(message);
  }

  String runtimeMessage(String message) {
    if (!isChinese) return message;
    final stripped = _stripErrorPrefix(message);
    if (stripped != message) return runtimeMessage(stripped);
    const processingPrefix = '; Device ASR processing failed:';
    final processingIndex = message.indexOf(processingPrefix);
    if (processingIndex >= 0) {
      final base = runtimeMessage(message.substring(0, processingIndex));
      return '$base；ASR 模型处理音频失败';
    }
    const diagnosticPrefix = '; Device ASR diagnostic:';
    final diagnosticIndex = message.indexOf(diagnosticPrefix);
    if (diagnosticIndex >= 0) {
      final base = runtimeMessage(message.substring(0, diagnosticIndex));
      final issue = message.substring(
        diagnosticIndex + diagnosticPrefix.length,
      );
      return '$base；端侧 ASR 诊断：${diagnosticsValue(issue.trim())}';
    }
    final reconnectMatch =
        RegExp(r'^Reconnecting \((\d+)/(\d+)\)$').firstMatch(message);
    if (reconnectMatch != null) {
      return '正在重连 (${reconnectMatch.group(1)}/${reconnectMatch.group(2)})';
    }
    if (message.startsWith('Device ASR is unavailable: ')) {
      final reason = message.substring('Device ASR is unavailable: '.length);
      return '端侧 ASR 当前不可用：${diagnosticsValue(reason)}';
    }
    return zhRuntimeMessages[message] ?? message;
  }

  String _text(String key) {
    final language = isChinese ? 'zh' : 'en';
    return appLocalizationTexts[key]?[language] ?? key;
  }

  String _stripErrorPrefix(String message) {
    const prefixes = <String>[
      'Unsupported operation: ',
      'Exception: ',
      'PlatformException(',
      'Bad state: ',
    ];
    for (final prefix in prefixes) {
      if (message.startsWith(prefix)) {
        return message.substring(prefix.length);
      }
    }
    return message;
  }
}

extension AppLocalizationsBuildContext on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) {
    return AppLocalizations.supportedLocales.any(
      (supportedLocale) => supportedLocale.languageCode == locale.languageCode,
    );
  }

  @override
  Future<AppLocalizations> load(Locale locale) {
    final languageCode =
        locale.languageCode.toLowerCase() == 'en' ? 'en' : 'zh';
    return SynchronousFuture<AppLocalizations>(
      AppLocalizations(Locale(languageCode)),
    );
  }

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}
