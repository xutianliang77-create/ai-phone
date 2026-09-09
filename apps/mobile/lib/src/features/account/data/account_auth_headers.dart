import 'account_session_store.dart';

class AccountAuthRequiredException implements Exception {
  const AccountAuthRequiredException();

  @override
  String toString() => '需要先登录账号';
}

Future<Map<String, String>> accountAuthorizationHeaders(
  AccountSessionStore store, {
  Map<String, String> baseHeaders = const <String, String>{},
  AccountRequestScope? scope,
  DateTime? now,
}) async {
  final session = await store.load();
  if (session == null || session.token.trim().isEmpty) {
    throw const AccountAuthRequiredException();
  }
  scope ??= store is DeploymentAccountSessionStore && session.ownerId != null
      ? AccountRequestScope(
          deploymentId: store.deploymentId,
          ownerId: session.ownerId!,
          apiBaseUrl: store.baseUrl)
      : null;
  if (scope != null &&
      (!scope.matches(session) ||
          !(DateTime.tryParse(session.expiresAtIso)
                  ?.isAfter(now ?? DateTime.now()) ??
              false))) {
    throw const AccountAuthRequiredException();
  }
  return <String, String>{
    for (final entry in baseHeaders.entries)
      if (scope == null || entry.key.toLowerCase() != 'authorization')
        entry.key: entry.value,
    'authorization': 'Bearer ${session.token}',
  };
}
