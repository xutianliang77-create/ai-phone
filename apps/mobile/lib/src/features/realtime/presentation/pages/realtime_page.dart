import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/app_language.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../../platform/speech/pcm_audio_output_player.dart';
import '../../../../platform/speech/speech_output_provider.dart';
import '../../../../platform/audio/audio_session_coordinator.dart';
import '../../../account/data/account_session_store.dart';
import '../../../account/presentation/widgets/account_required_panel.dart';
import '../../../compliance/data/voice_processing_consent_store.dart';
import '../../../compliance/presentation/widgets/voice_processing_consent_dialog.dart';
import '../../data/realtime_runtime_settings.dart';
import '../../data/realtime_settings_store.dart';
import '../../data/voice_preset_catalog.dart';
import '../controllers/realtime_controller.dart';
import '../realtime_online_recovery_policy.dart';
import '../realtime_settings_l10n.dart';
import '../widgets/realtime_controls.dart';
import '../widgets/realtime_language_menu.dart';
import '../widgets/realtime_online_recovery_actions.dart';
import '../widgets/realtime_settings_sheet_launcher.dart';
import '../widgets/realtime_status_bar.dart';
import '../widgets/subtitle_timeline.dart';

part 'realtime_page_online_helpers.dart';
part 'realtime_page_settings_helpers.dart';

class RealtimePage extends StatefulWidget {
  const RealtimePage({
    super.key,
    this.config,
    this.settingsStore,
    this.speechOutputProvider,
    this.voiceConsentStore,
    this.accountSessionStore,
    this.voicePresetClient,
  });

  final AppConfig? config;
  final RealtimeSettingsStore? settingsStore;
  final SpeechOutputProvider? speechOutputProvider;
  final VoiceProcessingConsentStore? voiceConsentStore;
  final AccountSessionStore? accountSessionStore;
  final VoicePresetClient? voicePresetClient;

  @override
  State<RealtimePage> createState() => _RealtimePageState();
}

class _RealtimePageState extends State<RealtimePage>
    with WidgetsBindingObserver {
  late final RealtimeSettingsStore _settingsStore;
  late final VoiceProcessingConsentStore _voiceConsentStore;
  late final AccountSessionStore _accountSessionStore;
  late final VoicePresetClient _voicePresetClient;
  late final bool _ownsVoicePresetClient;
  late AppConfig _config;
  late RealtimeRuntimeSettings _settings;
  late RealtimeController controller;
  bool _onlineRecoveryInFlight = false;
  bool _voicePresetsLoading = true;
  VoicePresetCatalog _voicePresetCatalog = const VoicePresetCatalog.empty();
  Timer? _finalizationReplayTimer;

  @override
  void initState() {
    super.initState();
    _settingsStore = widget.settingsStore ?? const FileRealtimeSettingsStore();
    _voiceConsentStore =
        widget.voiceConsentStore ?? const FileVoiceProcessingConsentStore();
    _accountSessionStore =
        widget.accountSessionStore ?? const FileAccountSessionStore();
    final baseConfig = widget.config ?? AppConfig.fromEnvironment();
    _ownsVoicePresetClient = widget.voicePresetClient == null;
    _voicePresetClient = widget.voicePresetClient ??
        VoicePresetClient(baseUrl: baseConfig.apiBaseUrl);
    _settings = RealtimeRuntimeSettings.fromConfig(baseConfig);
    _config = _settings.applyTo(baseConfig);
    controller = _createRealtimePageController(this, _config);
    WidgetsBinding.instance.addObserver(this);
    unawaited(controller.recoverPendingFinalizations());
    _finalizationReplayTimer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => unawaited(controller.recoverPendingFinalizations()),
    );
    unawaited(_loadSettings());
    unawaited(_loadVoicePresets());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _finalizationReplayTimer?.cancel();
    controller.dispose();
    if (_ownsVoicePresetClient) _voicePresetClient.close();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    unawaited(_handleLifecycleState(state));
  }

  Future<void> _handleLifecycleState(AppLifecycleState state) async {
    final current = controller;
    if (state == AppLifecycleState.resumed) {
      await current.recoverPendingFinalizations();
    }
    await current.handleLifecycleState(state);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final languageScope = AppLanguageScope.of(context);
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 76,
        titleSpacing: 0,
        title: AnimatedBuilder(
          animation: controller,
          builder: (context, _) => RealtimeStatusBar(
            status: controller.status,
            routeLabel: _routeLabel(l10n),
            message: controller.message,
            remainingSeconds: controller.remainingSeconds,
            lowBalance: controller.lowBalance,
            autoSpeakTranslation:
                _realtimeAutoSpeakSupported && controller.autoSpeakTranslation,
            autoSpeakEnabled: _realtimeAutoSpeakSupported,
            speechOutputActive: controller.speechOutputActive,
            onAutoSpeakChanged: controller.voiceOutputUpdating
                ? null
                : _toggleAutoSpeakTranslation,
          ),
        ),
        actions: <Widget>[
          RealtimeLanguageMenu(
            locale: languageScope.locale,
            onLocaleChanged: languageScope.onChanged,
            onOpenRealtimeSettings: _openRealtimeSettings,
          ),
        ],
      ),
      body: SafeArea(
        child: AnimatedBuilder(
          animation: controller,
          builder: (context, _) {
            return Column(
              children: <Widget>[
                RealtimeOnlineRecoveryActions(
                  visible:
                      _shouldShowOnlineRecovery && !_onlineRecoveryInFlight,
                  onRetryOnline: () => unawaited(_retryOnline()),
                  onSwitchToOnDevice: () => unawaited(_switchToOnDevice()),
                ),
                if (_shouldShowRealtimeAccountRequiredPanel(this))
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                    child: AccountRequiredPanel(
                      message: '在线同传需要登录账号。端侧模式可以不登录使用。',
                      onReturn: () => unawaited(_retryOnlineAfterLogin(this)),
                    ),
                  ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: SubtitleTimeline(
                      key: const ValueKey('realtime-subtitle-workspace'),
                      segments: controller.segments,
                      visualizerActive:
                          controller.status == RealtimeStatus.active,
                      visualizerPaused:
                          controller.status == RealtimeStatus.paused,
                    ),
                  ),
                ),
                RealtimeControls(
                  status: controller.status,
                  onStart: controller.start,
                  onPause: controller.pause,
                  onStop: controller.stop,
                  onBeforeStart: () => _ensureRealtimeStartAllowed(this),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  String _routeLabel(AppLocalizations l10n) {
    final source = l10n.languageDisplayName(_settings.sourceLanguage);
    final target = l10n.languageDisplayName(_settings.targetLanguage);
    return '$source  →  $target';
  }

  bool get _canChangeSettings {
    return controller.status == RealtimeStatus.idle ||
        isTerminalRealtimeStatus(controller.status);
  }

  bool get _canChangeMode => _canChangeSettings;

  bool get _realtimeAutoSpeakSupported =>
      realtimeModeSupportsVoiceOutput(_config.realtimeMode);

  bool get _shouldShowOnlineRecovery {
    return shouldShowOnlineRecovery(
      processingMode: _settings.processingMode,
      status: controller.status,
      diagnostic: controller.gatewayDiagnostic,
    );
  }

  Future<void> _retryOnline() async {
    if (!_shouldShowOnlineRecovery || _onlineRecoveryInFlight) return;
    if (!await _ensureRealtimeStartAllowed(this)) return;
    if (!mounted) return;
    setState(() => _onlineRecoveryInFlight = true);
    try {
      if (_isRunningForRecovery) {
        await controller.stop();
        if (!mounted) return;
      }
      await controller.start();
    } finally {
      if (mounted) setState(() => _onlineRecoveryInFlight = false);
    }
  }

  Future<void> _switchToOnDevice() async {
    if (!_shouldShowOnlineRecovery || _onlineRecoveryInFlight) return;
    final shouldRestart = _isRunningForRecovery;
    setState(() => _onlineRecoveryInFlight = true);
    try {
      if (shouldRestart) {
        await controller.stop();
        if (!mounted) return;
      }
      _changeSettings(
        _settings.copyWith(processingMode: RealtimeProcessingMode.onDevice),
      );
      if (shouldRestart && mounted) await controller.start();
    } finally {
      if (mounted) setState(() => _onlineRecoveryInFlight = false);
    }
  }

  bool get _isRunningForRecovery =>
      controller.status == RealtimeStatus.active ||
      controller.status == RealtimeStatus.paused;

  Future<void> _loadSettings() async {
    final savedSettings = await _settingsStore.load();
    if (!mounted || savedSettings == null) return;
    if (!_canChangeSettings) return;
    _replaceSettings(_normalizeVoicePreset(savedSettings));
  }

  Future<void> _loadVoicePresets() async {
    try {
      final catalog = await _voicePresetClient.load();
      if (!mounted) return;
      setState(() {
        _voicePresetCatalog = catalog;
        _voicePresetsLoading = false;
      });
      final normalized = _normalizeVoicePreset(_settings);
      if (normalized.voicePresetId != _settings.voicePresetId) {
        _replaceSettings(normalized);
        unawaited(_settingsStore.save(normalized));
      }
    } catch (_) {
      if (mounted) setState(() => _voicePresetsLoading = false);
    }
  }

  RealtimeRuntimeSettings _normalizeVoicePreset(
    RealtimeRuntimeSettings settings,
  ) {
    if (_voicePresetCatalog.presets.isEmpty ||
        _voicePresetCatalog.find(settings.voicePresetId) != null) {
      return settings;
    }
    return settings.copyWith(
      voicePresetId: _voicePresetCatalog.defaultPresetId,
    );
  }

  void _replaceSettings(RealtimeRuntimeSettings settings) {
    final nextConfig = settings.applyTo(_config);
    final previousController = controller;
    setState(() {
      _settings = settings;
      _config = nextConfig;
      controller = _createRealtimePageController(this, _config);
    });
    previousController.dispose();
  }

  void _replaceConfig(AppConfig nextConfig) {
    final previousController = controller;
    setState(() {
      _config = nextConfig;
      controller = _createRealtimePageController(this, _config);
    });
    previousController.dispose();
  }

  void _safeSetState(VoidCallback update) {
    if (!mounted) return;
    setState(update);
  }
}
