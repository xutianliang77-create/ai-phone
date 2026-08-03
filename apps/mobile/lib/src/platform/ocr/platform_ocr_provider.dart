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
  Future<MobileOcrResult?> recognizeImage(
    String imagePath, {
    List<String>? preferredScripts,
  }) async {
    final effectiveScripts = _effectiveScripts(preferredScripts);
    final result = await _channel.invokeMapMethod<String, Object?>(
      'recognizeImage',
      <String, Object?>{
        'imagePath': imagePath,
        'scripts': effectiveScripts,
      },
    );
    return MobileOcrResult(
      text: (result?['text'] as String? ?? '').trim(),
      provider: result?['provider'] as String? ?? 'platform_ocr',
      scripts: _stringList(result?['scripts']) ?? effectiveScripts,
      blocks: _blocks(result?['blocks']),
    );
  }

  @override
  Future<void> dispose() async {}

  List<String> _effectiveScripts(List<String>? preferredScripts) {
    final preferred = preferredScripts
        ?.where((script) => script == 'chinese' || script == 'latin')
        .toSet()
        .toList(growable: false);
    return preferred == null || preferred.isEmpty ? scripts : preferred;
  }

  List<String>? _stringList(Object? value) {
    if (value is! List) return null;
    return value.whereType<String>().toList(growable: false);
  }

  List<MobileOcrBlock> _blocks(Object? value) {
    if (value is! List) return const <MobileOcrBlock>[];
    return value.whereType<Map>().map((item) {
      return MobileOcrBlock(
        text: (item['text'] as String? ?? '').trim(),
        left: _coordinate(item['left']),
        top: _coordinate(item['top']),
        width: _coordinate(item['width']),
        height: _coordinate(item['height']),
      );
    }).where((block) {
      return block.text.isNotEmpty && block.width > 0 && block.height > 0;
    }).toList(growable: false);
  }

  double _coordinate(Object? value) {
    if (value is! num) return 0;
    return value.toDouble().clamp(0, 1);
  }
}
