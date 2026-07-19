import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/realtime/data/voice_preset_catalog.dart';

void main() {
  test('loads the provider voice preset catalog', () async {
    final client = VoicePresetClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      client: MockClient((request) async {
        expect(request.url.path, '/voice-presets');
        return http.Response.bytes(utf8.encode(jsonEncode({
          'version': 'catalog-v1',
          'defaultPresetId': 'zh_female_sichuanese',
          'presets': [
            {
              'id': 'zh_female_sichuanese',
              'labels': {'zh': '四川话女声', 'en': 'Sichuanese female'},
              'gender': 'female',
              'tone': 'lively',
              'scenario': 'conversation',
              'accent': 'sichuanese',
              'languages': ['zh'],
            },
          ],
        })), 200, headers: const {
          'content-type': 'application/json; charset=utf-8',
        });
      }),
    );

    final catalog = await client.load();

    expect(catalog.version, 'catalog-v1');
    expect(catalog.defaultPresetId, 'zh_female_sichuanese');
    expect(catalog.presets.single.zhLabel, '四川话女声');
    expect(catalog.presets.single.accent, 'sichuanese');
  });
}
