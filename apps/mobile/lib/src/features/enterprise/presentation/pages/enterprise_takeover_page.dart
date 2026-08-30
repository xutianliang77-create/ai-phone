import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import '../../data/enterprise_mobile_api_client.dart';
import '../../data/enterprise_mobile_models.dart';
import '../../data/enterprise_support_api.dart';
import '../../data/enterprise_support_models.dart';
import '../../data/enterprise_support_workbench_models.dart';
import '../widgets/enterprise_mobile_status_panel.dart';

part 'enterprise_takeover_page_sections.dart';
part 'enterprise_takeover_page_queue_actions.dart';

class EnterpriseTakeoverPage extends StatefulWidget {
  const EnterpriseTakeoverPage({
    required this.client,
    required this.workspace,
    super.key,
  });

  final EnterpriseMobileApiClient client;
  final EnterpriseMobileWorkspace workspace;

  @override
  State<EnterpriseTakeoverPage> createState() => _EnterpriseTakeoverPageState();
}

class _EnterpriseTakeoverPageState extends State<EnterpriseTakeoverPage>
    with WidgetsBindingObserver {
  List<EnterpriseMobileSupportQueue> _queues = const [];
  List<EnterpriseMobileSupportWorkItem> _workItems = const [];
  final Map<String, String> _claimKeys = <String, String>{};
  String? _selectedQueueId;
  EnterpriseMobileSupportClaim? _claim;
  EnterpriseMobileSupportSession? _session;
  EnterpriseMobileSupportWorkbench? _workbench;
  Timer? _renewTimer;
  String? _releaseKey;
  String? _error;
  String? _traceId;
  bool _loading = true;
  bool _acting = false;

  bool get _allowed => widget.workspace.context.can('support:takeover');
  bool get _hasClaim => _claim != null && _session != null;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_loadQueues());
  }

  @override
  void didUpdateWidget(covariant EnterpriseTakeoverPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.workspace.context.tenant.id !=
        widget.workspace.context.tenant.id) {
      final claim = _claim;
      final session = _session;
      final releaseKey = _releaseKey ?? _uuid();
      _stopLocalControl();
      if (claim != null && session != null) {
        unawaited(_releaseSafely(
          oldWidget.workspace,
          claim,
          session,
          releaseKey,
          'agent_disconnect',
        ));
      }
      _queues = const [];
      _workItems = const [];
      _selectedQueueId = null;
      _claimKeys.clear();
      unawaited(_loadQueues());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (!_hasClaim) unawaited(_loadQueues());
      return;
    }
    if (state == AppLifecycleState.inactive) return;
    final claim = _claim;
    final session = _session;
    final releaseKey = _releaseKey ?? _uuid();
    if (claim == null || session == null) return;
    _stopLocalControl(
      message: 'App 已离开前台，本地接管控制立即停止；服务端按释放请求或租约到期收敛。',
    );
    unawaited(_releaseSafely(
      widget.workspace,
      claim,
      session,
      releaseKey,
      'agent_disconnect',
    ));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    final claim = _claim;
    final session = _session;
    final releaseKey = _releaseKey ?? _uuid();
    _renewTimer?.cancel();
    if (claim != null && session != null) {
      unawaited(_releaseSafely(
        widget.workspace,
        claim,
        session,
        releaseKey,
        'agent_disconnect',
      ));
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_allowed) {
      return const _TakeoverBody(children: <Widget>[
        EnterpriseMobileStatusPanel(
          status: EnterpriseMobileStatus.forbidden,
          description: '当前成员缺少 support:takeover，未读取或执行任何接管操作。',
        ),
      ]);
    }
    return _TakeoverBody(children: <Widget>[
      _takeoverHeader(),
      if (_error != null) _errorPanel(),
      if (_hasClaim) ..._activeClaimSections() else ..._queueSections(),
    ]);
  }

  Future<void> _activateWorkbench() async {
    final session = _session;
    if (session == null) return;
    _setActing(true);
    try {
      final workbench = await widget.client.activateSupportWorkbench(
        widget.workspace,
        session.id,
      );
      if (!mounted || _claim?.id != workbench.claim.id) return;
      setState(() {
        _claim = workbench.claim;
        _session = workbench.session;
        _workbench = workbench;
        _error = null;
        _traceId = null;
      });
      _scheduleRenewal();
    } catch (error) {
      _recordError(error, prefix: '已取得数据库 claim，但工作台未激活。');
    } finally {
      _setActing(false);
    }
  }

  Future<void> _refreshWorkbench() async {
    final session = _session;
    if (session == null || _acting) return;
    _setActing(true);
    try {
      final workbench = await widget.client.getSupportWorkbench(
        widget.workspace,
        session.id,
      );
      if (!mounted || _claim?.id != workbench.claim.id) return;
      setState(() {
        _claim = workbench.claim;
        _session = workbench.session;
        _workbench = workbench;
        _error = null;
        _traceId = null;
      });
      _scheduleRenewal();
    } catch (error) {
      _failClosed(error, '工作台刷新失败，本地接管控制已停止。');
    } finally {
      _setActing(false);
    }
  }

  void _scheduleRenewal() {
    _renewTimer?.cancel();
    final claim = _claim;
    if (claim == null || !claim.isActive) {
      _stopLocalControl(message: '接管租约已过期，本地控制已停止。');
      return;
    }
    final remaining = claim.leaseExpiresAt.difference(DateTime.now());
    if (remaining <= const Duration(seconds: 5)) {
      _stopLocalControl(message: '接管租约即将过期，本地控制已停止。');
      return;
    }
    final halfSeconds = max(1, remaining.inSeconds ~/ 2);
    _renewTimer = Timer(
      Duration(seconds: min(30, halfSeconds)),
      () => unawaited(_renewClaim()),
    );
  }

  Future<void> _renewClaim() async {
    final current = _claim;
    if (current == null) return;
    try {
      final renewed = await widget.client.renewSupportClaim(
        widget.workspace,
        current,
      );
      if (!mounted || _claim?.id != current.id) return;
      setState(() => _claim = renewed);
      _scheduleRenewal();
    } catch (error) {
      _failClosed(error, '接管租约续期失败，本地控制已停止。');
    }
  }

  Future<void> _release() async {
    final claim = _claim;
    final session = _session;
    if (claim == null || session == null || _acting) return;
    final key = _releaseKey ??= _uuid();
    _stopLocalControl(message: '本地接管控制已停止，正在等待服务端释放结果。');
    _setActing(true);
    try {
      await _releaseRemote(
        widget.workspace,
        claim,
        session,
        key,
        'agent_release',
      );
      if (mounted) {
        setState(() {
          _error = null;
          _traceId = null;
        });
        await _loadQueues();
      }
    } catch (error) {
      _recordError(
        error,
        prefix: '本地控制已停止；释放结果未知，服务端将按相同幂等键或租约到期收敛。',
      );
    } finally {
      _setActing(false);
    }
  }

  void _failClosed(Object error, String message) {
    final claim = _claim;
    final session = _session;
    final releaseKey = _releaseKey ?? _uuid();
    _stopLocalControl(message: message);
    if (claim != null && session != null) {
      unawaited(_releaseSafely(
        widget.workspace,
        claim,
        session,
        releaseKey,
        'agent_disconnect',
      ));
    }
    _recordError(error, prefix: message);
  }

  void _stopLocalControl({String? message}) {
    _renewTimer?.cancel();
    if (!mounted) return;
    setState(() {
      _claim = null;
      _session = null;
      _workbench = null;
      _releaseKey = null;
      if (message != null) _error = message;
    });
  }

  void _recordError(Object error, {String? prefix}) {
    if (!mounted) return;
    final apiError = error is EnterpriseMobileApiException ? error : null;
    setState(() {
      _traceId = apiError?.traceId;
      _error = <String>[
        if (prefix != null) prefix,
        apiError?.message ?? '企业接管请求未完成。',
      ].join(' ');
    });
  }

  void _setLoading(bool value) {
    if (mounted) setState(() => _loading = value);
  }

  void _setActing(bool value) {
    if (mounted) setState(() => _acting = value);
  }

  void _update(VoidCallback change) {
    if (mounted) setState(change);
  }
}

class _TakeoverBody extends StatelessWidget {
  const _TakeoverBody({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: children,
      );
}

String _uuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex =
      bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
