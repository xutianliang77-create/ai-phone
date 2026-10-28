import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:translation_mobile/src/platform/diagnostics/subscription_load_diagnostics.dart';

class _DocumentsPath extends PathProviderPlatform {
  _DocumentsPath(this.path);
  final String path;

  @override
  Future<String?> getApplicationDocumentsPath() async => path;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'local diagnostics are QA-only, bounded and exclude untrusted data',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'v10-subscription-observation-',
      );
      final previous = PathProviderPlatform.instance;
      PathProviderPlatform.instance = _DocumentsPath(directory.path);
      try {
        for (var i = 0; i < 35; i++) {
          await recordSubscriptionLoadEvent({
            'attempt': 1,
            'stage': 'storekit',
            'outcome': 'failed',
            'durationMs': i,
            'errorCode': 'SYNTHETIC_PRIVATE_ERROR',
            'ownerId': 'SYNTHETIC_PRIVATE_OWNER',
            'details': 'SYNTHETIC_PRIVATE_DETAILS',
          });
        }
        final file = File(
          '${directory.path}/wujie-subscription-load-stages.json',
        );
        if (const String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') ==
            'A13_QA') {
          final contents = await file.readAsString();
          final data = jsonDecode(contents) as Map<String, dynamic>;
          expect(data['credentialsRecorded'], false);
          expect((data['events'] as List).length, 30);
          expect(contents, isNot(contains('SYNTHETIC_PRIVATE')));
          expect((data['events'] as List).last['stage'], 'storekit');
        } else {
          expect(await file.exists(), false);
        }
      } finally {
        PathProviderPlatform.instance = previous;
        await directory.delete(recursive: true);
      }
    },
  );
}
