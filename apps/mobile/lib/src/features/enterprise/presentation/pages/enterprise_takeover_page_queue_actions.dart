part of 'enterprise_takeover_page.dart';

extension _EnterpriseTakeoverQueueActions on _EnterpriseTakeoverPageState {
  Future<void> _loadQueues() async {
    if (!_allowed) return;
    final workspace = widget.workspace;
    final tenantId = workspace.context.tenant.id;
    _setLoading(true);
    try {
      final queues = await widget.client.listSupportQueues(workspace);
      final active = queues.where((queue) => queue.status == 'active').toList();
      final selected = active.any((queue) => queue.id == _selectedQueueId)
          ? _selectedQueueId
          : active.firstOrNull?.id;
      if (!mounted || widget.workspace.context.tenant.id != tenantId) return;
      _update(() {
        _queues = queues;
        _selectedQueueId = selected;
        _error = null;
        _traceId = null;
      });
      if (selected != null) await _loadWorkItems(selected);
    } catch (error) {
      _recordError(error);
    } finally {
      _setLoading(false);
    }
  }

  Future<void> _loadWorkItems(String queueId) async {
    if (!_allowed || _hasClaim) return;
    final workspace = widget.workspace;
    final tenantId = workspace.context.tenant.id;
    _setLoading(true);
    try {
      final items = await widget.client.listSupportWorkItems(
        workspace,
        queueId,
      );
      if (!mounted ||
          widget.workspace.context.tenant.id != tenantId ||
          queueId != _selectedQueueId) {
        return;
      }
      _update(() {
        _workItems = items;
        _error = null;
        _traceId = null;
      });
    } catch (error) {
      _recordError(error);
    } finally {
      _setLoading(false);
    }
  }

  Future<void> _claimSession(EnterpriseMobileSupportWorkItem item) async {
    if (_acting || _hasClaim) return;
    final workspace = widget.workspace;
    final tenantId = workspace.context.tenant.id;
    final key = _claimKeys.putIfAbsent(item.sessionId, _uuid);
    _setActing(true);
    try {
      final result = await widget.client.claimSupportSession(
        workspace,
        item,
        key,
      );
      if (!mounted || widget.workspace.context.tenant.id != tenantId) {
        await _releaseSafely(
          workspace,
          result.claim,
          result.session,
          _uuid(),
          'agent_disconnect',
        );
        return;
      }
      _update(() {
        _claim = result.claim;
        _session = result.session;
        _workbench = null;
        _releaseKey = _uuid();
        _error = null;
        _traceId = null;
      });
      _scheduleRenewal();
      await _activateWorkbench();
      _claimKeys.remove(item.sessionId);
    } catch (error) {
      _recordError(error);
    } finally {
      _setActing(false);
    }
  }

  Future<void> _releaseRemote(
    EnterpriseMobileWorkspace workspace,
    EnterpriseMobileSupportClaim claim,
    EnterpriseMobileSupportSession session,
    String key,
    String reason,
  ) async {
    await widget.client.releaseSupportClaim(
      workspace,
      claim,
      session,
      key,
      reason: reason,
    );
  }

  Future<void> _releaseSafely(
    EnterpriseMobileWorkspace workspace,
    EnterpriseMobileSupportClaim claim,
    EnterpriseMobileSupportSession session,
    String key,
    String reason,
  ) async {
    try {
      await _releaseRemote(workspace, claim, session, key, reason);
    } catch (_) {
      // Local authority is already removed; the bounded server lease remains
      // the fail-closed recovery path when disconnect delivery is unknown.
    }
  }
}
