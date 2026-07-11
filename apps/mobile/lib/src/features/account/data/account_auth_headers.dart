import 'account_session_store.dart';

class AccountAuthRequiredException implements Exception {
  const AccountAuthRequiredException();

  @override
  String toString() => '需要先登录账号';
}

Future<Map<String, String>> accountAuthorizationHeaders(
  AccountSessionStore store, {
  Map<String, String> baseHeaders = const <String, String>{},
}) async {
  final session = await store.load();
  if (session == null || session.token.trim().isEmpty) {
    throw const AccountAuthRequiredException();
  }
  return <String, String>{
    ...baseHeaders,
    'authorization': 'Bearer ${session.token}',
  };
}
