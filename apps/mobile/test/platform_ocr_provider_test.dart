import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/ocr/platform_ocr_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('translation_mobile/ocr');

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('preserves normalized OCR text block coordinates', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      expect(call.method, 'recognizeImage');
      return <String, Object?>{
        'text': '菜单',
        'provider': 'ios_vision',
        'scripts': <String>['chinese'],
        'blocks': <Map<String, Object?>>[
          <String, Object?>{
            'text': '菜单',
            'left': 0.1,
            'top': 0.2,
            'width': 0.5,
            'height': 0.1,
          },
        ],
      };
    });

    final result = await PlatformOcrProvider().recognizeImage('/tmp/menu.png');

    expect(result?.text, '菜单');
    expect(result?.blocks, hasLength(1));
    expect(result?.blocks.single.left, 0.1);
    expect(result?.blocks.single.top, 0.2);
    expect(result?.blocks.single.width, 0.5);
    expect(result?.blocks.single.height, 0.1);
  });
}
