import 'dart:io';
import 'package:path_provider/path_provider.dart';
import '../../account/data/account_scoped_http.dart';
import '../../account/data/account_session_store.dart';
import '../../realtime/domain/entities/subtitle_segment.dart';
import 'local_session_store.dart';
import 'session_history_models.dart';

/// New account-scoped files coexist with the untouched, unowned legacy file.
/// An account change cannot redirect an in-flight save to the new owner.
class OwnedLocalSessionStore extends LocalSessionStore {
  OwnedLocalSessionStore({
    AccountSessionStore? account,
    Future<Directory> Function()? directory,
  }) : account = account ?? defaultAccountSessionStore(),
       directory = directory ?? getApplicationDocumentsDirectory;
  final AccountSessionStore account;
  final Future<Directory> Function() directory;
  Future<LocalSessionStore> pin() async {
    final op = await ScopedAccountOperation.capture(account);
    final scope = AccountRequestScope(
      deploymentId: op.original.deploymentId!,
      ownerId: op.original.ownerId!,
      apiBaseUrl: Uri.parse(op.original.issuerOrigin!),
    );
    final dir = await directory();
    await op.check();
    return LocalSessionStore(
      file: File('${dir.path}/translation-owner-${scope.storageKey}.json'),
    );
  }

  Future<T> _run<T>(Future<T> Function(LocalSessionStore) action) async {
    final op = await ScopedAccountOperation.capture(account),
        store = await pin();
    await op.check();
    final value = await action(store);
    await op.check();
    return value;
  }

  @override
  Future<List<SessionListItem>> listSessions({String query = ''}) =>
      _run((s) => s.listSessions(query: query));
  @override
  Future<SessionDetail> getSession(String sessionId) =>
      _run((s) => s.getSession(sessionId));
  @override
  Future<void> saveEndedSession({
    required String sessionId,
    required DateTime createdAt,
    required List<SubtitleSegment> segments,
  }) => _run(
    (s) => s.saveEndedSession(
      sessionId: sessionId,
      createdAt: createdAt,
      segments: segments,
    ),
  );
  @override
  Future<SessionExport> exportSession(
    String sessionId, {
    String format = 'markdown',
  }) => _run((s) => s.exportSession(sessionId, format: format));
  @override
  Future<void> deleteSession(String sessionId) =>
      _run((s) => s.deleteSession(sessionId));
  @override
  Future<SessionDetail> renameSpeaker(
    String sessionId,
    String speakerId,
    String displayName,
  ) => _run((s) => s.renameSpeaker(sessionId, speakerId, displayName));
  @override
  Future<SessionDetail> updateActionItem(
    String sessionId,
    int actionIndex,
    bool completed,
  ) => _run((s) => s.updateActionItem(sessionId, actionIndex, completed));
}
