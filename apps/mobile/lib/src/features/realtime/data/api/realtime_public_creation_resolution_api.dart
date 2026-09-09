part of 'realtime_api_client.dart';

extension RealtimePublicCreationResolutionApi on RealtimeApiClient {
  Future<PublicCreationResolution?> resolvePendingPublicCreation(
      {String action = 'query', PublicCreationResolution? expected}) async {
    if (_publicCreationClosed || publicDeploymentId.isEmpty ||
        _publicCreating != null || _publicIssued != null || _publicResolving ||
        _baseUrl.scheme != 'https' || _baseUrl.userInfo.isNotEmpty ||
        _baseUrl.hasQuery || _baseUrl.hasFragment ||
        !const ['query', 'cancel', 'expire'].contains(action) ||
        (action != 'query' && (expected == null || !expected.canRetire)) ||
        (action == 'expire' && expected?.state != 'expired_pending')) {
      throw const RealtimeApiException('当前不能处置未决创建，请先停止并查询');
    }
    _publicResolving = true;
    final epoch = ++_publicCreationEpoch, accountEpoch = accountGeneration;
    _publicCreationAbort = Completer<void>();
    bool current() => !_publicCreationClosed && epoch == _publicCreationEpoch &&
      accountEpoch == accountGeneration && !_publicCreationAbort!.isCompleted;
    void check() { if (!current()) throw const RealtimeApiException('未决创建身份或操作已失效'); }
    try {
      final account = await _creationWait(publicLifecycleAccount(), epoch);
      check();
      final scope = AccountRequestScope(deploymentId: publicDeploymentId,
          ownerId: account.ownerId!, apiBaseUrl: _baseUrl).storageKey;
      final pending = await _creationWait(_publicCreationStore.pending(scope), epoch);
      check();
      if (pending == null) {
        if (action != 'query') throw const RealtimeApiException('原请求已变化，请重新查询');
        return null;
      }
      final key = pending['key']! as String;
      if (expected != null && (expected.scope != scope ||
          expected.accountGeneration != accountEpoch || expected.requestKey != key)) {
        throw const RealtimeApiException('查询身份已变化，请重新查询');
      }
      await _creationWait(verifyAccountDeployment(
          _client, _baseUrl, publicDeploymentId, _requestTimeout), epoch);
      check();
      Future<void> verify() async {
        check();
        final a = await _creationWait(publicLifecycleAccount(), epoch);
        check();
        if (a.ownerId != account.ownerId || a.token != account.token) {
          throw const AccountAuthRequiredException();
        }
      }
      await verify();
      final random = Random.secure();
      final nonce = List.generate(32, (_) => random.nextInt(256)
          .toRadixString(16).padLeft(2, '0')).join();
      final body = pending['body'];
      final response = await _publicCreateHttp('POST',
          '/realtime/creation-requests/$action', account.token, epoch,
          body: {'request': body, 'nonce': nonce}, requestKey: key);
      await verify();
      final result = PublicCreationResolution.checked(response,
          owner: account.ownerId!, deployment: publicDeploymentId,
          key: key, scope: scope, generation: accountEpoch, nonce: nonce, body: body);
      if (action != 'query' && !result.terminal) {
        throw const RealtimeApiException('服务端尚未确认作废，原请求已保留');
      }
      if (result.terminal) {
        // Do not time out a local atomic commit then permit a competing create.
        // The store checks operation/account epoch immediately before rename.
        await _publicCreationStore.retire(result, isCurrent: current);
        await verify();
      }
      return result;
    } finally {
      _publicResolving = false;
    }
  }
}
