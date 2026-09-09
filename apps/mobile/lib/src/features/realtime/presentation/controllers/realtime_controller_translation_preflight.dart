part of 'realtime_controller.dart';

extension RealtimeControllerTranslationPreflight on RealtimeController {
  Future<void> _prepareOnDeviceTranslation() async {
    if (!_config.useOnDeviceTranslation) return;
    final provider = _mobileTranslationProvider;
    if (provider == null) {
      throw UnsupportedError('On-device translation unavailable');
    }
    final diagnostics = provider is MobileTranslationDiagnostics
        ? provider as MobileTranslationDiagnostics
        : null;
    if (diagnostics == null) return;
    final configs = createOnDeviceTranslationPreflightConfigs(_config);
    if (configs.isEmpty) {
      if (_config.sourceLanguage == autoSourceLanguageCode &&
          !_config.autoReverseTargetLanguage) {
        return;
      }
      throw UnsupportedError(
          'Select an explicit valid translation language pair');
    }
    _message = 'Checking on-device translation language packs';
    _notify();
    for (final config in configs) {
      await _checkOnDeviceTranslationResources(config);
    }
    _message = 'On-device translation ready';
    _notify();
  }

  Future<void> _checkOnDeviceTranslationResources(
      MobileTranslationConfig config) async {
    final provider = _mobileTranslationProvider;
    if (provider is! MobileTranslationDiagnostics) return;
    final availability =
        await (provider as MobileTranslationDiagnostics).availability(config);
    if (!availability.available) {
      throw UnsupportedError(
          _onDeviceTranslationUnavailableMessage(availability.reason));
    }
    if (!availability.matchesLanguagePair(config)) {
      throw UnsupportedError(_onDeviceTranslationUnavailableMessage(
          'translation_language_mismatch'));
    }
  }
}

String _onDeviceTranslationUnavailableMessage(String reason) {
  return switch (reason) {
    'language_pair_not_installed' =>
      'On-device translation language pack is not installed',
    'unsupported_language_pair' =>
      'The requested on-device translation language pair is not supported',
    'translation_language_mismatch' =>
      'On-device translation resources do not match the requested languages',
    'ios_translation_requires_ios_26' =>
      'On-device translation requires iOS 26 or newer',
    _ => 'On-device translation unavailable',
  };
}
