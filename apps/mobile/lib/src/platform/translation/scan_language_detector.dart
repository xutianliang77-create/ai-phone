import 'package:flutter/services.dart';

/// The native recognizer considers all languages before applying the allowed
/// pair, so an unsupported language is never forced into Chinese or English.
class ScanLanguageDetector {
  ScanLanguageDetector({MethodChannel? channel})
    : _channel = channel ?? const MethodChannel('translation_mobile/ocr');
  final MethodChannel _channel;

  Future<String?> detect(String text) async {
    final result = await _channel.invokeMapMethod<String, Object?>(
      'detectLanguage',
      {'text': text},
    );
    final language = result?['language'];
    return language == 'zh' || language == 'en' ? language as String : null;
  }
}
