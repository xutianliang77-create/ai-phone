part of 'realtime_page.dart';

void _openRealtimeSettingsForPage(_RealtimePageState state) {
  showRealtimeSettingsSheet(
    context: state.context,
    listenable: state.controller,
    realtimeMode: () => state._config.realtimeMode,
    settings: () => state._settings,
    enabled: () => true,
    modeEnabled: () => true,
    autoSpeakSupported: () => state._realtimeAutoSpeakSupported,
    onRealtimeModeChanged: state._changeRealtimeMode,
    onSettingsChanged: state._changeSettings,
    voicePresets: state._voicePresetCatalog.presets,
    voicePresetsLoading: state._voicePresetsLoading,
  );
}

extension _RealtimePageSettingsActions on _RealtimePageState {
  void _openRealtimeSettings() {
    _openRealtimeSettingsForPage(this);
  }

  void _changeRealtimeMode(String realtimeMode) {
    if (!_canChangeMode) {
      _showSettingsLockedMessage();
      return;
    }
    if (realtimeMode == _config.realtimeMode) return;
    _replaceConfig(_config.copyWith(realtimeMode: realtimeMode));
  }

  void _changeSettings(RealtimeRuntimeSettings settings) {
    if (!_canChangeSettings) {
      if (_isAutoSpeakOnlyChange(settings)) {
        _applyAutoSpeakSetting(settings);
        return;
      }
      _showSettingsLockedMessage();
      return;
    }
    if (settings == _settings) return;
    _replaceSettings(settings);
    unawaited(_settingsStore.save(settings));
  }

  void _toggleAutoSpeakTranslation(bool enabled) {
    _changeSettings(_settings.copyWith(autoSpeakTranslation: enabled));
  }

  bool _isAutoSpeakOnlyChange(RealtimeRuntimeSettings settings) {
    return settings.processingMode == _settings.processingMode &&
        settings.sourceLanguage == _settings.sourceLanguage &&
        settings.targetLanguage == _settings.targetLanguage &&
        settings.voicePresetId == _settings.voicePresetId &&
        settings.autoSpeakTranslation != _settings.autoSpeakTranslation;
  }

  void _applyAutoSpeakSetting(RealtimeRuntimeSettings settings) {
    _safeSetState(() => _settings = settings);
    controller.setAutoSpeakTranslation(
      _realtimeAutoSpeakSupported && settings.autoSpeakTranslation,
    );
    unawaited(_settingsStore.save(settings));
  }

  void _showSettingsLockedMessage() {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.l10n.settingsLockedHint)),
    );
  }
}
