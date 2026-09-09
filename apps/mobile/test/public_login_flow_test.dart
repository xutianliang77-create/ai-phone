import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:translation_mobile/src/features/account/data/account_api_client.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/account/presentation/pages/account_page.dart';

void main() {
  testWidgets(
      'original login page binds returned owner and clears locally before slow logout',
      (tester) async {
    final logout = Completer<http.Response>();
    final store = MemoryAccountSessionStore();
    final api = AccountApiClient(
        baseUrl: Uri.parse('https://login.test'),
        deploymentId: 'public-test',
        client: MockClient((r) async {
          expect(r.followRedirects, isFalse);
          if (r.url.path == '/auth/deployment') {
            expect(r.headers.containsKey('authorization'), isFalse);
            return response({'deploymentId': 'public-test'});
          }
          if (r.url.path == '/auth/phone/login') {
            expect(jsonDecode(r.body)['deploymentId'], 'public-test');
            return response(login());
          }
          expect(r.url.path, '/auth/logout');
          return logout.future;
        }));
    addTearDown(api.close);
    await tester.pumpWidget(
        MaterialApp(home: AccountPage(client: api, sessionStore: store)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), '13800138000');
    await tester.enterText(find.byType(TextField).at(1), '123456');
    await tester.tap(find.text('登录'));
    await tester.pumpAndSettle();
    expect(store.session!.ownerId, 'server-owner');
    expect(store.session!.deploymentId, 'public-test');
    expect(store.session!.issuerOrigin, 'https://login.test');
    await tester.tap(find.text('退出登录'));
    await tester.pump();
    await tester.pump();
    expect(store.session, isNull);
    logout.complete(response({'status': 'ok'}));
    await tester.pumpAndSettle();
    expect(find.text('已退出登录'), findsOneWidget);
  });
  test('missing or wrong deployment response is not accepted as public login',
      () async {
    for (final deployment in [null, 'wrong']) {
      final api = AccountApiClient(
          baseUrl: Uri.parse('https://login.test'),
          deploymentId: 'public-test',
          client: MockClient(
              (_) async => response({...login(), 'deploymentId': deployment})));
      await expectLater(
          api.loginWithPhoneCode(phone: '13800138000', code: '123456'),
          throwsA(isA<AccountApiException>()));
      api.close();
    }
  });
  test(
      'legacy deployment is refused before code requests or credentials are sent',
      () async {
    final paths = <String>[];
    final api = AccountApiClient(
        baseUrl: Uri.parse('https://legacy.test'),
        deploymentId: 'public-test',
        client: MockClient((r) async {
          paths.add(r.url.path);
          expect(r.headers.containsKey('authorization'), isFalse);
          return http.Response('{}', 404);
        }));
    addTearDown(api.close);
    await expectLater(api.requestPhoneCode('13800138000'),
        throwsA(isA<AccountApiException>()));
    expect(paths, ['/auth/deployment']);
  });
  test(
      'deployment account pointer switches owner and never imports or erases private login',
      () async {
    final directory =
        Directory.systemTemp.createTempSync('public-login-pointer-');
    final before = PathProviderPlatform.instance;
    PathProviderPlatform.instance = _Paths(directory.path);
    addTearDown(() {
      PathProviderPlatform.instance = before;
      directory.deleteSync(recursive: true);
    });
    const private = FileAccountSessionStore();
    await private.save(const AccountSession(
        token: 'private-only', expiresAtIso: '2099-01-01T00:00:00Z'));
    final original =
        await File('${directory.path}/account_session.json').readAsBytes();
    final store = DeploymentAccountSessionStore(
        deploymentId: 'public-test', baseUrl: Uri.parse('https://login.test'));
    expect(await store.load(), isNull);
    AccountSession session(String id) => AccountSession(
        token: 'synthetic-$id',
        expiresAtIso: '2099-01-01T00:00:00Z',
        deploymentId: 'public-test',
        ownerId: id,
        issuerOrigin: 'https://login.test');
    await store.save(session('a'));
    final epoch = store.generation;
    await store.save(session('b'));
    expect((await store.load())!.ownerId, 'b');
    expect(store.generation, greaterThan(epoch));
    final cleared = store.clear();
    expect(await store.load(), isNull);
    await cleared;
    expect(await File('${directory.path}/account_session.json').readAsBytes(),
        original);
    final save = store.save(session('a'));
    final clear = store.clear();
    await Future.wait([save, clear]);
    expect(await store.load(), isNull);
    await store.save(session('b'));
    expect((await store.load())!.ownerId, 'b');
  });
}

Map<String, Object?> login() => {
      'deploymentId': 'public-test',
      'token': 'synthetic-token',
      'expiresAt': '2099-01-01T00:00:00Z',
      'account': {
        'id': 'server-owner',
        'phoneMasked': '138****8000',
        'status': 'active',
        'createdAt': '2026-01-01T00:00:00Z'
      }
    };
http.Response response(Object body) => http.Response(jsonEncode(body), 200,
    headers: {'content-type': 'application/json; charset=utf-8'});

class _Paths extends PathProviderPlatform {
  _Paths(this.path);
  final String path;
  @override
  Future<String?> getApplicationSupportPath() async => path;
}
