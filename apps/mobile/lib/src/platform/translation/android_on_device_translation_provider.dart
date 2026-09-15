import 'package:flutter/services.dart';

import 'mobile_translation_provider.dart';
import 'translation_language_pair.dart';

/// Android counterpart to the existing iOS system translator.  The native
/// bridge refuses to translate until both ML Kit language models are already
/// present, so invoking this provider never silently downloads or uploads text.
class AndroidOnDeviceTranslationProvider
    implements
        MobileTranslationProvider,
        MobileTranslationDiagnostics,
        MobileTranslationResourcePreparation {
  AndroidOnDeviceTranslationProvider({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel(_channelName);

  static const _channelName = 'translation_mobile/android_on_device_translation';

  final MethodChannel _channel;

  @override
  Future<void> dispose() async {}

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
    final result = await _channel.invokeMapMethod<String, Object?>(
      'translate',
      <String, Object?>{'text': text, ..._languageArguments(config)},
    );
    if (!_matchesRequestedPair(result, config)) {
      throw PlatformException(
        code: 'translation_language_mismatch',
        message: 'Android on-device translation returned a different language pair.',
        details: result,
      );
    }
    final translated = result?['text'] as String?;
    if (translated == null || translated.trim().isEmpty) {
      throw PlatformException(
        code: 'empty_translation',
        message: 'Android on-device translation returned no text.',
        details: result,
      );
    }
    return MobileTranslationResult(
      text: translated.trim(),
      provider: result?['provider'] as String? ?? 'android_mlkit',
    );
  }

  @override
  Future<void> prepareResources(
    MobileTranslationConfig config, {
    required String requestId,
  }) {
    if (requestId.trim().isEmpty) {
      throw ArgumentError('A resource request identity is required');
    }
    return _channel.invokeMethod<void>('prepare', <String, Object?>{
      ..._languageArguments(config),
      'requestId': requestId,
      'downloadAuthorized': true,
    });
  }

  @override
  Future<void> cancelResourcePreparation(String requestId) => _channel
      .invokeMethod<void>('cancelPreparation', <String, Object?>{
        'requestId': requestId,
      });

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
    if (result?['available'] == true && !_matchesRequestedPair(result, config)) {
      return _unavailable(
        config,
        'translation_language_mismatch',
        message: 'Installed Android translation models do not match the requested pair.',
        details: result,
      );
    }
    final available = result?['available'] == true;
    return MobileTranslationAvailability(
      available: available,
      provider: result?['provider'] as String? ?? 'android_mlkit',
      sourceLanguage:
          result?['sourceLanguage'] as String? ?? config.sourceLanguage,
      targetLanguage:
          result?['targetLanguage'] as String? ?? config.targetLanguage,
      status: result?['status'] as String? ??
          (available ? 'installed' : 'unavailable'),
      reason: result?['reason'] as String? ??
          (available ? 'ready' : 'on_device_translation_unavailable'),
      message: result?['message'] as String?,
      details: result ?? const <String, Object?>{},
    );
  }

  bool _matchesRequestedPair(
    Map<String, Object?>? result,
    MobileTranslationConfig config,
  ) {
    return result?['sourceLanguage'] is String &&
        result?['targetLanguage'] is String &&
        translationLanguagesMatch(
          result!['sourceLanguage'] as String,
          config.sourceLanguage,
        ) &&
        translationLanguagesMatch(
          result['targetLanguage'] as String,
          config.targetLanguage,
        );
  }

  MobileTranslationAvailability _unavailable(
    MobileTranslationConfig config,
    String reason, {
    String? message,
    Map<String, Object?>? details,
  }) {
    return MobileTranslationAvailability(
      available: false,
      provider: 'android_mlkit',
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
      status: 'unavailable',
      reason: reason,
      message: message,
      details: details ?? const <String, Object?>{},
    );
  }
}
