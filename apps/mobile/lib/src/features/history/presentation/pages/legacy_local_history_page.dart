import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../account/data/account_session_events.dart';
import '../../data/local_session_store.dart';
import '../../data/session_history_models.dart';
import '../../../../platform/sharing/local_file_share_service.dart';

/// The file has no account provenance; device authentication is a privacy
/// boundary, not a claim that the current account owns the old records.
class LegacyLocalHistoryPage extends StatefulWidget {
  const LegacyLocalHistoryPage({super.key, this.store, this.authenticate});
  final LocalSessionStore? store;
  final Future<bool> Function()? authenticate;
  @override
  State<LegacyLocalHistoryPage> createState() => _LegacyLocalHistoryPageState();
}

class _LegacyLocalHistoryPageState extends State<LegacyLocalHistoryPage> with WidgetsBindingObserver {
  late final store = widget.store ?? LocalSessionStore();
  StreamSubscription<void>? _accountChanges;
  Future<List<SessionListItem>>? _sessions;
  bool _authorized = false, _verifying = false;
  Route<void>? _recordRoute;
  int _epoch = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _accountChanges = AccountSessionEvents.changes.listen((_) => _lock());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden ||
        (state == AppLifecycleState.inactive && _authorized)) { _lock(); }
  }

  void _lock() {
    _epoch++;
    final route = _recordRoute;
    _recordRoute = null;
    if (route != null && route.isActive && mounted) {
      Navigator.of(context, rootNavigator: true).removeRoute(route);
    }
    if (mounted) setState(() { _authorized = false; _sessions = null; });
  }

  Future<void> _unlock() async {
    if (_verifying) return;
    final epoch = ++_epoch;
    setState(() { _verifying = true; _error = null; });
    try {
      final approved = await (widget.authenticate?.call() ??
          const MethodChannel('translation_mobile/apple_account')
              .invokeMethod<bool>('authenticateLegacyRecords', <String, Object?>{}).then((v) => v == true));
      if (!mounted || epoch != _epoch) return;
      setState(() {
        _authorized = approved;
        if (approved) { _sessions = store.listSessions(); }
        else { _error = '未完成设备身份验证。旧记录未打开。'; }
      });
    } catch (_) {
      if (mounted && epoch == _epoch) setState(() => _error = '设备身份验证不可用，请检查手机锁屏设置。');
    } finally {
      if (mounted) setState(() => _verifying = false);
    }
  }

  @override
  void dispose() {
    _epoch++;
    WidgetsBinding.instance.removeObserver(this);
    _accountChanges?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('本机旧记录（未绑定账号）')),
    body: !_authorized
      ? Padding(padding: const EdgeInsets.all(16), child: Column(
          crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('旧记录无法确认原账号归属。验证手机解锁身份后可查看；知道此手机密码的人也可能查看。记录不会自动归入当前账号。'),
            if (_error != null) Text(_error!),
            TextButton(onPressed: _verifying ? null : _unlock,
              child: Text(_verifying ? '正在验证…' : '验证身份并查看旧记录')),
          ]))
      : FutureBuilder<List<SessionListItem>>(
          future: _sessions,
          builder: (context, snapshot) {
            if (snapshot.hasError) return const Center(child: Text('旧记录读取失败；原文件未修改。'));
            if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
            return ListView(children: [
              const Padding(padding: EdgeInsets.all(16),
                child: Text('此入口仅供查看和导出。设备身份验证不代表记录属于当前账号。')),
              for (final item in snapshot.requireData)
                ListTile(title: Text(item.title ?? item.sessionId), subtitle: Text(item.createdAt.toLocal().toString()),
                  onTap: () => _showRecord(item)),
            ]);
          },
        ),
  );

  Future<void> _showRecord(SessionListItem item) async {
    final epoch = _epoch;
    Route<void>? route;
    try {
      final detail = await store.getSession(item.sessionId);
      if (!mounted || !_authorized || epoch != _epoch) return;
      route = DialogRoute<void>(context: context, builder: (dialogContext) => AlertDialog(
        title: const Text('本机旧记录'),
        content: SingleChildScrollView(child: SelectableText(detail.segments.map(
          (v) => '${v.sourceText}\n${v.translatedText}').join('\n\n'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('关闭')),
          TextButton(onPressed: () async {
            if (!_authorized || epoch != _epoch) return;
            final export = await store.exportSession(item.sessionId);
            if (!mounted || !_authorized || epoch != _epoch) return;
            final sharing = LocalFileShareService();
            final path = await sharing.saveExportFile(utf8.encode(export.content), export.filename);
            if (!mounted || !_authorized || epoch != _epoch) return;
            await sharing.shareFile(path, mimeType: export.mimeType);
          }, child: const Text('导出')),
        ],
      ));
      _recordRoute = route;
      await Navigator.of(context, rootNavigator: true).push(route);
    } catch (_) {
      if (mounted && _authorized && epoch == _epoch) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('读取旧记录失败；原文件未修改。')));
      }
    } finally { if (identical(_recordRoute, route)) _recordRoute = null; }
  }
}
