import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/account/data/account_api_client.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/account/presentation/pages/account_page.dart';

void main() {
  testWidgets('logs in with phone code and saves token', (tester) async {
    final client = _FakeAccountApiClient();
    final store = MemoryAccountSessionStore();
    await tester.pumpWidget(_TestApp(
      child: AccountPage(client: client, sessionStore: store),
    ));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).at(0), '13800138000');
    await tester.tap(find.text('获取验证码'));
    await tester.pumpAndSettle();

    expect(find.text('开发验证码：123456'), findsOneWidget);

    await tester.enterText(find.byType(TextField).at(1), '123456');
    await tester.tap(find.text('登录'));
    await tester.pumpAndSettle();

    expect(store.session?.token, 'token_1');
    expect(find.text('138****8000'), findsOneWidget);
    expect(find.text('导出个人信息副本'), findsOneWidget);
  });

  testWidgets('exports account data and logs out', (tester) async {
    final client = _FakeAccountApiClient();
    final store = MemoryAccountSessionStore(
      const AccountSession(
        token: 'token_1',
        expiresAtIso: '2026-08-01T00:00:00.000Z',
      ),
    );
    await tester.pumpWidget(_TestApp(
      child: AccountPage(client: client, sessionStore: store),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('导出个人信息副本'));
    await tester.pumpAndSettle();

    expect(find.text('个人信息副本已生成'), findsOneWidget);
    expect(find.textContaining('历史会话：2'), findsOneWidget);
    expect(find.textContaining('同意记录：4'), findsOneWidget);

    await tester.tap(find.text('退出登录'));
    await tester.pumpAndSettle();

    expect(client.loggedOutToken, 'token_1');
    expect(store.session, isNull);
    expect(find.text('手机号'), findsOneWidget);
  });

  testWidgets('clears the local session when remote logout fails',
      (tester) async {
    final client = _FakeAccountApiClient()..failLogout = true;
    final store = MemoryAccountSessionStore(
      const AccountSession(
        token: 'token_1',
        expiresAtIso: '2026-08-01T00:00:00.000Z',
      ),
    );
    await tester.pumpWidget(_TestApp(
      child: AccountPage(client: client, sessionStore: store),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('退出登录'));
    await tester.pumpAndSettle();

    expect(store.session, isNull);
    expect(find.text('手机号'), findsOneWidget);
    expect(find.text('已退出本机；服务器会话将在登录令牌到期后失效'), findsOneWidget);
  });

  testWidgets('requests account deletion after confirmation', (tester) async {
    final client = _FakeAccountApiClient();
    final store = MemoryAccountSessionStore(
      const AccountSession(
        token: 'token_1',
        expiresAtIso: '2026-08-01T00:00:00.000Z',
      ),
    );
    await tester.pumpWidget(_TestApp(
      child: AccountPage(client: client, sessionStore: store),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('注销账号'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('确认注销'));
    await tester.pumpAndSettle();

    expect(client.deletedToken, 'token_1');
    expect(store.session, isNull);
    expect(find.text('注销请求已提交，账号已退出'), findsOneWidget);
  });
}

class _TestApp extends StatelessWidget {
  const _TestApp({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(home: child);
  }
}

class _FakeAccountApiClient extends AccountApiClient {
  _FakeAccountApiClient() : super(baseUrl: Uri.parse('http://localhost'));

  String? loggedOutToken;
  String? deletedToken;
  bool failLogout = false;

  @override
  Future<PhoneCodeChallenge> requestPhoneCode(String phone) async {
    return PhoneCodeChallenge(
      challengeId: 'challenge_1',
      phoneMasked: '138****8000',
      expiresAt: DateTime.utc(2026, 8),
      debugCode: '123456',
    );
  }

  @override
  Future<AccountLoginResult> loginWithPhoneCode({
    required String phone,
    required String code,
  }) async {
    if (code != '123456') {
      throw const AccountApiException('/auth/phone/login failed: 401', {});
    }
    return AccountLoginResult(
      token: 'token_1',
      expiresAt: DateTime.utc(2026, 8),
      account: _profile(),
    );
  }

  @override
  Future<AccountProfile> fetchMe(String token) async => _profile();

  @override
  Future<AccountExportData> exportData(String token) async {
    return AccountExportData(
      exportedAt: DateTime.utc(2026, 7, 6),
      sessionCount: 2,
      ledgerCount: 1,
      termCount: 3,
      agentCallCount: 1,
      consentCount: 4,
    );
  }

  @override
  Future<void> logout(String token) async {
    if (failLogout) {
      throw const AccountApiException(
        '/auth/logout failed: network_error',
        <String, Object?>{},
      );
    }
    loggedOutToken = token;
  }

  @override
  Future<AccountProfile> requestDeletion(String token) async {
    deletedToken = token;
    return _profile(status: 'deletion_requested');
  }

  AccountProfile _profile({String status = 'active'}) {
    return AccountProfile(
      id: 'user_1',
      phoneMasked: '138****8000',
      status: status,
      createdAt: DateTime.utc(2026, 7, 6),
    );
  }
}
