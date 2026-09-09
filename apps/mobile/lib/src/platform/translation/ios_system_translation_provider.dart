import 'package:flutter/services.dart';

import 'mobile_translation_provider.dart';
import 'translation_language_pair.dart';

class IosSystemTranslationProvider
    implements
        MobileTranslationProvider,
        MobileTranslationDiagnostics,
        MobileTranslationResourcePreparation {
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
    Map<String, Object?>? result;
    try {
      result = await _channel.invokeMapMethod<String, Object?>(
        'translate',
        <String, Object?>{'text': text, ..._languageArguments(config)},
      );
    } on MissingPluginException {
      if (_fallback == null) rethrow;
      return _fallback.translate(text, config);
    } on PlatformException {
      if (_fallback == null) rethrow;
      return _fallback.translate(text, config);
    }
    if (!_matchesRequestedPair(result, config)) {
      throw PlatformException(
          code: 'translation_language_mismatch',
          message:
              'System translation returned a different or missing language pair.',
          details: result);
    }
    final translatedText = result?['text'] as String?;
    if (translatedText == null || translatedText.trim().isEmpty) {
      if (_fallback != null) return _fallback.translate(text, config);
      throw PlatformException(
          code: 'empty_translation',
          message: 'System translation returned no translated text.');
    }
    return MobileTranslationResult(
        text: translatedText.trim(),
        provider: result?['provider'] as String? ?? 'ios_system');
  }

  @override
  Future<void> dispose() async {
    await _fallback?.dispose();
  }

  @override
  Future<void> prepareResources(MobileTranslationConfig config,
      {required String requestId}) {
    if (requestId.isEmpty) {
      throw ArgumentError('A resource request identity is required');
    }
    return _channel.invokeMethod<void>('prepare', {
      ..._languageArguments(config),
      'requestId': requestId,
      'downloadAuthorized': true,
    });
  }

  @override
  Future<void> cancelResourcePreparation(String requestId) => _channel
      .invokeMethod<void>('cancelPreparation', {'requestId': requestId});

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
    if (result?['available'] == true &&
        !_matchesRequestedPair(result, config)) {
      return MobileTranslationAvailability(
          available: false,
          provider: 'ios_system',
          sourceLanguage: config.sourceLanguage,
          targetLanguage: config.targetLanguage,
          status: 'unavailable',
          reason: 'translation_language_mismatch',
          message:
              'Installed translation resources do not match the requested language pair.',
          details: result ?? const {});
    }
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

  bool _matchesRequestedPair(
      Map<String, Object?>? result, MobileTranslationConfig config) {
    return result?['sourceLanguage'] is String &&
        result?['targetLanguage'] is String &&
        translationLanguagesMatch(
            result!['sourceLanguage'] as String, config.sourceLanguage) &&
        translationLanguagesMatch(
            result['targetLanguage'] as String, config.targetLanguage);
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
