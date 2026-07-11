import 'package:flutter/services.dart';

class SpeechOutputResult {
  const SpeechOutputResult({
    required this.provider,
    required this.language,
  });

  final String provider;
  final String language;
}

abstract class SpeechOutputProvider {
  Future<SpeechOutputResult> speak({
    required String text,
    required String language,
  });

  Future<void> stop();
}

class SystemSpeechOutputProvider implements SpeechOutputProvider {
  SystemSpeechOutputProvider({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel(_channelName);

  static const _channelName = 'translation_mobile/speech_output';

  final MethodChannel _channel;

  @override
  Future<SpeechOutputResult> speak({
    required String text,
    required String language,
  }) async {
    final result = await _channel.invokeMapMethod<String, Object?>(
      'speak',
      <String, Object?>{
        'text': text,
        'language': language,
      },
    );
    return SpeechOutputResult(
      provider: result?['provider'] as String? ?? 'system_tts',
      language: result?['language'] as String? ?? language,
    );
  }

  @override
  Future<void> stop() async {
    await _channel.invokeMethod<void>('stop');
  }
}
