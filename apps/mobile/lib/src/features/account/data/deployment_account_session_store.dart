part of 'account_session_store.dart';

AccountSessionStore accountStoreForDeployment(Uri baseUrl,
        {String deploymentId = configuredPublicDeploymentId}) =>
    deploymentId.isEmpty
        ? const FileAccountSessionStore()
        : DeploymentAccountSessionStore(
            deploymentId: deploymentId, baseUrl: baseUrl);

/// Owner pointer contains no token. Credentials remain in the existing scoped
/// store, never in the private legacy file. Epoch changes invalidate in-flight work.
class DeploymentAccountSessionStore
    implements AccountSessionStore, AccountSessionGeneration {
  DeploymentAccountSessionStore(
      {required this.deploymentId, required this.baseUrl}) {
    _scope('active-account');
  }
  final String deploymentId;
  final Uri baseUrl;
  static final _epochs = <String, int>{};
  static final _writes = <String, Future<void>>{};
  static final _blocked = <String>{};
  String get _key => _scope('active-account').storageKey;
  @override
  int get generation => _epochs[_key] ?? 0;
  void _invalidate() => _epochs[_key] = generation + 1;
  AccountRequestScope _scope(String owner) => AccountRequestScope(
      deploymentId: deploymentId, ownerId: owner, apiBaseUrl: baseUrl);
  Future<File> _pointer() async => File(
      '${(await getApplicationSupportDirectory()).path}/account_active_v11_$_key.json');
  @override
  Future<AccountSession?> load() async {
    if (_blocked.contains(_key)) return null;
    final epoch = generation;
    final value = await _loadSelected();
    return epoch == generation && !_blocked.contains(_key) ? value : null;
  }

  Future<AccountSession?> _loadSelected() async {
    try {
      final file = await _pointer();
      if (!await file.exists()) return null;
      final owner = (jsonDecode(await file.readAsString()) as Map)['ownerId'];
      if (owner is! String || owner.isEmpty) return null;
      return FileAccountSessionStore(scope: _scope(owner)).load();
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> save(AccountSession session) async {
    if (session.ownerId == null || !_scope(session.ownerId!).matches(session)) {
      throw StateError('Public login identity mismatch');
    }
    _invalidate();
    _blocked.add(_key);
    final epoch = generation;
    await _serialized(() async {
      await FileAccountSessionStore(scope: _scope(session.ownerId!))
          .save(session);
      final pointer = await _pointer();
      await pointer.parent.create(recursive: true);
      if (epoch != generation) return;
      final temporary = File('${pointer.path}.$epoch.tmp');
      await temporary.writeAsString(jsonEncode({'ownerId': session.ownerId}),
          flush: true);
      if (epoch == generation) {
        await temporary.rename(pointer.path);
        if (epoch == generation) _blocked.remove(_key);
      }
    });
  }

  @override
  Future<void> clear() async {
    _invalidate();
    _blocked.add(_key);
    final epoch = generation;
    await _serialized(() async {
      final session = await _loadSelected();
      final pointer = await _pointer();
      if (epoch != generation) return;
      if (await pointer.exists()) await pointer.delete();
      if (session?.ownerId != null && epoch == generation) {
        await FileAccountSessionStore(scope: _scope(session!.ownerId!)).clear();
      }
    });
  }

  Future<void> _serialized(Future<void> Function() action) async {
    final previous = _writes[_key] ?? Future<void>.value();
    final done = Completer<void>();
    _writes[_key] = done.future;
    await previous.catchError((Object _) {});
    try {
      await action();
    } finally {
      done.complete();
      if (identical(_writes[_key], done.future)) _writes.remove(_key);
    }
  }
}
