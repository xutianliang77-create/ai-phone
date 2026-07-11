part of 'realtime_page.dart';

Future<bool> _ensureRealtimeStartAllowed(_RealtimePageState state) async {
  if (state._settings.processingMode != RealtimeProcessingMode.online) {
    return true;
  }
  final session = await state._accountSessionStore.load();
  if (!state.mounted) return false;
  if (session == null) {
    await openAccountLoginPage(state.context);
    return false;
  }
  return ensureVoiceProcessingConsent(
    context: state.context,
    store: state._voiceConsentStore,
    scene: VoiceProcessingConsentScene.realtimeOnline,
  );
}

bool _shouldShowRealtimeAccountRequiredPanel(_RealtimePageState state) {
  return state._settings.processingMode == RealtimeProcessingMode.online &&
      isAccountAuthRequiredError(state.controller.message);
}

Future<void> _retryOnlineAfterLogin(_RealtimePageState state) async {
  if (!state.mounted || !state._canChangeSettings) return;
  final session = await state._accountSessionStore.load();
  if (!state.mounted || session == null) return;
  if (!await _ensureRealtimeStartAllowed(state)) return;
  if (!state.mounted) return;
  await state.controller.start();
}

RealtimeController _createRealtimePageController(
  _RealtimePageState state,
  AppConfig config,
) {
  final autoSpeakTranslation =
      state._realtimeAutoSpeakSupported && state._settings.autoSpeakTranslation;
  return RealtimeController(
    config: config,
    autoSpeakTranslation: autoSpeakTranslation,
    speechOutputProvider: state._realtimeAutoSpeakSupported
        ? state.widget.speechOutputProvider ?? SystemSpeechOutputProvider()
        : null,
    pcmAudioOutputPlayer: SystemPcmAudioOutputPlayer(),
  );
}
