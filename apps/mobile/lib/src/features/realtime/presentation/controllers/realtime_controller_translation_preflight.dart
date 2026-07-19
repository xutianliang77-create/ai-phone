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
    _message = 'Checking on-device translation language packs';
    _notify();
    for (final config in createOnDeviceTranslationPreflightConfigs(_config)) {
      final availability = await diagnostics.availability(config);
      if (!availability.available) {
        throw UnsupportedError(
          _onDeviceTranslationUnavailableMessage(availability.reason),
        );
      }
    }
    _message = 'On-device translation ready';
    _notify();
  }
}

String _onDeviceTranslationUnavailableMessage(String reason) {
  return switch (reason) {
    'language_pair_not_installed' =>
      'On-device translation language pack is not installed',
    'unsupported_language_pair' =>
      'On-device translation only supports Chinese and English',
    'ios_translation_requires_ios_26' =>
      'On-device translation requires iOS 26 or newer',
    _ => 'On-device translation unavailable',
  };
}
