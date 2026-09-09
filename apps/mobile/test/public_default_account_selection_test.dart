import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/account/data/account_auth_headers.dart';
import 'package:translation_mobile/src/features/history/data/session_history_api_client.dart';
import 'package:translation_mobile/src/features/billing/data/billing_api_client.dart';
import 'package:translation_mobile/src/features/voice_profile/data/voice_profile_api_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'default API account selection respects the configured deployment without reading private credentials',
      () async {
    final uri = Uri.parse('https://public-default.test');
    if (configuredPublicDeploymentId.isEmpty) {
      expect(accountStoreForDeployment(uri), isA<FileAccountSessionStore>());
      return;
    }
    final directory = Directory.systemTemp.createTempSync('public-default-');
    final previous = PathProviderPlatform.instance;
    PathProviderPlatform.instance = _Paths(directory.path);
    addTearDown(() {
      PathProviderPlatform.instance = previous;
      directory.deleteSync(recursive: true);
    });
    await const FileAccountSessionStore().save(const AccountSession(
        token: 'synthetic-private-only', expiresAtIso: '2099-01-01T00:00:00Z'));
    final original =
        await File('${directory.path}/account_session.json').readAsBytes();
    final http = MockClient(
        (_) async => throw StateError('must not transmit private credentials'));
    final history = SessionHistoryApiClient(baseUrl: uri, client: http);
    final billing = BillingApiClient(baseUrl: uri, client: http);
    final voice = VoiceProfileApiClient(baseUrl: uri, client: http);
    await expectLater(
        history.listSessions(), throwsA(isA<AccountAuthRequiredException>()));
    await expectLater(
        billing.fetchBalance(), throwsA(isA<AccountAuthRequiredException>()));
    await expectLater(
        voice.fetchMyProfile(), throwsA(isA<AccountAuthRequiredException>()));
    expect(await File('${directory.path}/account_session.json').readAsBytes(),
        original);
    http.close();
  });
}

class _Paths extends PathProviderPlatform {
  _Paths(this.path);
  final String path;
  @override
  Future<String?> getApplicationSupportPath() async => path;
}
