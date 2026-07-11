import 'package:flutter/services.dart';

import 'mobile_translation_provider.dart';

class IosSystemTranslationProvider
    implements MobileTranslationProvider, MobileTranslationDiagnostics {
  IosSystemTranslationProvider({
    MethodChannel? channel,
    MobileTranslationProvider? fallback,
  })  : _channel = channel ?? const MethodChannel(_channelName),
        _fallback = fallback;

  static const _channelName = 'translation_mobile/on_device_translation';

  final MethodChannel _channel;
  final MobileTranslationProvider? _fallback;

  @override
  Future<MobileTranslationAvailability> availability(
    MobileTranslationConfig config,
  ) async {
    try {
      final result = await _channel.invokeMapMethod<String, Object?>(
        'isAvailable',
        _languageArguments(config),
      );
      return _availabilityFromResult(result, config);
    } on MissingPluginException {
      return _unavailable(config, 'missing_plugin');
    } on PlatformException catch (error) {
      return _unavailable(config, error.code, message: error.message);
    }
  }

  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    try {
      final result = await _channel.invokeMapMethod<String, Object?>(
        'translate',
        <String, Object?>{'text': text, ..._languageArguments(config)},
      );
      final translatedText = result?['text'] as String?;
      if (translatedText == null || translatedText.trim().isEmpty) {
        return _fallback?.translate(text, config);
      }
      return MobileTranslationResult(
        text: translatedText.trim(),
        provider: result?['provider'] as String? ?? 'ios_system',
      );
    } on MissingPluginException {
      return _fallback?.translate(text, config);
    } on PlatformException {
      return _fallback?.translate(text, config);
    }
  }

  @override
  Future<void> dispose() async {
    await _fallback?.dispose();
  }

  Map<String, Object?> _languageArguments(MobileTranslationConfig config) {
    return <String, Object?>{
      'sourceLanguage': config.sourceLanguage,
      'targetLanguage': config.targetLanguage,
    };
  }

  MobileTranslationAvailability _availabilityFromResult(
    Map<String, Object?>? result,
    MobileTranslationConfig config,
  ) {
    final available = result?['available'] == true;
    return MobileTranslationAvailability(
      available: available,
      provider: result?['provider'] as String? ?? 'ios_system',
      sourceLanguage:
          result?['sourceLanguage'] as String? ?? config.sourceLanguage,
      targetLanguage:
          result?['targetLanguage'] as String? ?? config.targetLanguage,
      status:
          result?['status'] as String? ?? (available ? 'installed' : 'unknown'),
      reason: result?['reason'] as String? ??
          (available ? 'ready' : 'on_device_translation_unavailable'),
      message: result?['message'] as String?,
      details: result ?? const <String, Object?>{},
    );
  }

  Future<MobileTranslationAvailability> _unavailable(
    MobileTranslationConfig config,
    String reason, {
    String? message,
  }) async {
    final fallback = _fallback;
    final details = <String, Object?>{};
    if (fallback is MobileTranslationDiagnostics) {
      final diagnostics = fallback as MobileTranslationDiagnostics;
      details['fallback'] = (await diagnostics.availability(config)).toJson();
    }
    return MobileTranslationAvailability(
      available: false,
      provider: 'ios_system',
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
      status: 'unavailable',
      reason: reason,
      message: message,
      details: details,
    );
  }
}
