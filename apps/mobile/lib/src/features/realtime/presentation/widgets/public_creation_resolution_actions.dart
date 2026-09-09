import 'package:flutter/material.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../data/api/public_creation_resolution.dart';
import '../controllers/realtime_controller.dart';

/// Inline actions on the original realtime page, not another management screen.
class PublicCreationResolutionActions extends StatefulWidget {
  const PublicCreationResolutionActions({required this.controller, super.key});
  final RealtimeController controller;
  @override
  State<PublicCreationResolutionActions> createState() => _ActionsState();
}

class _ActionsState extends State<PublicCreationResolutionActions> {
  PublicCreationResolution? _result;
  bool _queried = false, _failed = false;
  int? _generation;
  @override
  void didUpdateWidget(covariant PublicCreationResolutionActions oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      _result = null; _queried = false; _failed = false; _generation = null;
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.controller,
    builder: (context, _) {
      final c = widget.controller, zh = context.l10n.isChinese;
      if (!c.publicCreationResolutionAvailable && !c.publicCreationResolutionBusy) {
        _result = null; _queried = false; _failed = false; _generation = null;
        return const SizedBox.shrink();
      }
      final valid = _generation == c.publicCreationAccountGeneration;
      final r = valid ? _result : null;
      final busy = c.publicCreationResolutionBusy;
      return Padding(padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (_queried && valid) Text(_failed
            ? (zh ? '查询或处置未确认，请检查登录和网络后重新查询；原请求未自动清除。'
                : 'Not confirmed. Check sign-in and network, then query again. The request was not automatically cleared.')
            : _status(r?.state, zh)),
          Wrap(alignment: WrapAlignment.center, spacing: 8, children: [
            TextButton(onPressed: busy ? null : () => _run('query'),
              child: Text(zh ? '查看未决创建' : 'Check pending creation')),
            if (!_failed && r?.canRetire == true) TextButton(
              onPressed: busy ? null : () => _confirm('cancel', r!),
              child: Text(zh ? '撤销未开始请求' : 'Cancel unstarted request')),
            if (!_failed && r?.state == 'expired_pending') TextButton(
              onPressed: busy ? null : () => _confirm('expire', r!),
              child: Text(zh ? '确认过期处置' : 'Retire expired request')),
            if (busy) TextButton(onPressed: c.cancelPublicCreationResolutionWait,
              child: Text(zh ? '停止等待' : 'Stop waiting')),
          ]),
        ]));
    });

  Future<void> _confirm(String action, PublicCreationResolution expected) async {
    final zh = context.l10n.isChinese, c = widget.controller;
    final yes = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
      title: Text(zh ? '确认处置未开始请求？' : 'Retire this unstarted request?'),
      content: Text(zh ? '只处置刚查询的请求，不删除历史、不处理已运行会话，也不会自动开始新会话。'
          : 'Only the queried request is affected. History and running sessions are untouched. No new session starts automatically.'),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false),
          child: Text(zh ? '返回' : 'Back')),
        TextButton(onPressed: () => Navigator.pop(context, true), child: Text(zh ? '确认' : 'Confirm'))]));
    if (!mounted || c != widget.controller || yes != true) return;
    await _run(action, expected: expected);
  }

  Future<void> _run(String action, {PublicCreationResolution? expected}) async {
    final c = widget.controller, generation = c.publicCreationAccountGeneration;
    try {
      final result = await c.resolvePendingPublicCreation(action: action, expected: expected);
      if (!mounted || c != widget.controller || generation != c.publicCreationAccountGeneration) return;
      setState(() { _result = result; _failed = false; _queried = true; _generation = generation; });
    } catch (_) {
      if (!mounted || c != widget.controller || generation != c.publicCreationAccountGeneration) return;
      setState(() { _result = null; _failed = true; _queried = true; _generation = generation; });
    }
  }

  String _status(String? state, bool zh) => switch (state) {
    null => zh ? '本账号没有待确认创建请求。' : 'No pending creation for this account.',
    'not_found' => zh ? '服务器暂未找到；不能直接换键，可明确撤销此请求。' : 'Not found yet. Cancel explicitly before replacing the request.',
    'prepared' || 'issued' => zh ? '请求已准备或发行但未开始；可按原设置重试，或明确撤销。' : 'Prepared or issued, not started. Retry original settings or cancel explicitly.',
    'expired_pending' => zh ? '请求已过期，尚待确认处置。' : 'Expired; retirement is not yet confirmed.',
    'cancelled' || 'expired' => zh ? '作废回执已保存；可修改设置后手动开始。' : 'Retirement receipt saved. Change settings and start manually.',
    _ => zh ? '已有运行记录或证据不完整；请使用原结束确认流程，不能按未使用释放。' : 'Runtime or incomplete evidence requires the existing end-confirmation flow; no unused-session release.',
  };
}
