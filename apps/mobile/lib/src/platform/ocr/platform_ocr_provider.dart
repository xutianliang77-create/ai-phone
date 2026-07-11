import 'package:flutter/services.dart';

import 'mobile_ocr_provider.dart';

class PlatformOcrProvider implements MobileOcrProvider {
  PlatformOcrProvider({
    MethodChannel? channel,
    this.scripts = const <String>['chinese', 'latin'],
  }) : _channel = channel ?? const MethodChannel(_channelName);

  static const _channelName = 'translation_mobile/ocr';

  final MethodChannel _channel;
  final List<String> scripts;

  @override
  Future<MobileOcrResult?> recognizeImage(String imagePath) async {
    final result = await _channel.invokeMapMethod<String, Object?>(
      'recognizeImage',
      <String, Object?>{
        'imagePath': imagePath,
        'scripts': scripts,
      },
    );
    return MobileOcrResult(
      text: (result?['text'] as String? ?? '').trim(),
      provider: result?['provider'] as String? ?? 'platform_ocr',
      scripts: _stringList(result?['scripts']) ?? scripts,
    );
  }

  @override
  Future<void> dispose() async {}

  List<String>? _stringList(Object? value) {
    if (value is! List) return null;
    return value.whereType<String>().toList(growable: false);
  }
}
