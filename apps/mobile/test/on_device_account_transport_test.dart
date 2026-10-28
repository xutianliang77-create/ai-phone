import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_api_client.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/account/data/apple_identity_client.dart';

class _UntrustedIdentity extends AppleIdentityClient {
  const _UntrustedIdentity();
  @override
  Future<Map<String, Object?>> signIn({
    required String nonce,
    required String state,
    required String bundleId,
  }) async => {
    'state': state,
    'identityToken': {'sourceText': 'SYNTHETIC_PRIVATE_CONTENT_MUST_NOT_LEAVE'},
    'authorizationCode': 'synthetic-code',
  };
}

class _MemoryClient extends AccountApiClient {
  _MemoryClient(Uri origin, http.Client client, this.store)
    : super(baseUrl: origin, client: client);
  final AccountSessionStore store;
  @override
  AccountSessionStore createSessionStore() => store;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final origin = Uri.parse(configuredAccountApiBaseUrl);
  Map<String, Object?> identity() => {
    'deploymentId': configuredPublicDeploymentId,
    'backend': 'cloudflare',
    'bundleId': configuredPublicBundleId,
    'execution': 'on_device',
    'controlContract': 'v10-device-license-v1',
  };
  Map<String, Object?> challenge() => {
    'deploymentId': configuredPublicDeploymentId,
    'challengeId': 'synthetic-challenge',
    'nonce': 'synthetic-nonce',
    'state': 'synthetic-state',
    'bindingSecret': 'synthetic-binding',
    'privacyVersion': configuredPrivacyVersion,
    'termsVersion': configuredTermsVersion,
  };
  test(
    'on-device Apple challenge sends one structured metadata POST after identity verification',
    () async {
      expect(onDeviceExecution, isTrue);
      final sent = <http.Request>[];
      final transport = MockClient((request) async {
        sent.add(request);
        return http.Response(
          jsonEncode(
            request.url.path == '/auth/deployment' ? identity() : challenge(),
          ),
          200,
        );
      });
      final result = await AccountApiClient(
        baseUrl: origin,
        client: transport,
      ).appleChallenge();
      expect(result['challengeId'], 'synthetic-challenge');
      expect(sent.map((r) => r.method).toList(), ['GET', 'POST']);
      expect(jsonDecode(sent.last.body), {
        'deploymentId': configuredPublicDeploymentId,
        'action': 'login',
      });
      expect(sent.every((r) => !r.followRedirects), isTrue);
      expect(
        sent.every((r) => !r.headers.containsKey('authorization')),
        isTrue,
      );
    },
  );
  test(
    'account login transport refuses nested business content before dispatch',
    () async {
      var loginPosts = 0;
      final transport = MockClient((request) async {
        if (request.url.path == '/auth/deployment') {
          return http.Response(jsonEncode(identity()), 200);
        }
        loginPosts++;
        return http.Response(
          '{"error":{"code":"apple_invalid_identity"}}',
          403,
        );
      });
      await expectLater(
        AccountApiClient(baseUrl: origin, client: transport).loginWithApple(
          challenge(),
          privacyAccepted: true,
          termsAccepted: true,
          identity: const _UntrustedIdentity(),
        ),
        throwsA(isA<AccountApiException>()),
      );
      expect(
        loginPosts,
        0,
        reason:
            'A metadata guard must see the original JSON tree, not a JSON-encoded string.',
      );
    },
  );
  test(
    'on-device authenticated account GET keeps an empty body and correct owner scope',
    () async {
      final session = AccountSession(
        token: 'synthetic-token',
        expiresAtIso: '2099-01-01T00:00:00Z',
        ownerId: 'synthetic-owner',
        deploymentId: configuredPublicDeploymentId,
        issuerOrigin: origin.origin,
      );
      final sent = <http.Request>[];
      final transport = MockClient((request) async {
        sent.add(request);
        return http.Response(
          jsonEncode(
            request.url.path == '/auth/deployment'
                ? identity()
                : {
                    'account': {
                      'id': 'synthetic-owner',
                      'phoneMasked': '',
                      'status': 'active',
                      'createdAt': '2026-10-28T00:00:00Z',
                    },
                  },
          ),
          200,
        );
      });
      final result = await _MemoryClient(
        origin,
        transport,
        MemoryAccountSessionStore(session),
      ).fetchMe(session.token);
      expect(result.id, 'synthetic-owner');
      expect(sent.last.method, 'GET');
      expect(sent.last.body, isEmpty);
      expect(sent.last.headers['authorization'], 'Bearer synthetic-token');
    },
  );
}
