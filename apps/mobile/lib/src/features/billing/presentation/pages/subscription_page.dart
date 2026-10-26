import 'package:flutter/material.dart';
import '../../data/on_device_subscription_client.dart';
import '../../../account/presentation/widgets/account_required_panel.dart';
import '../../../compliance/data/compliance_document.dart';
import '../../../compliance/presentation/pages/compliance_document_page.dart';
import '../../../../app/app_config.dart';
import '../../../realtime/presentation/pages/on_device_resources_page.dart';

class SubscriptionPage extends StatefulWidget {
  const SubscriptionPage({this.client, super.key});
  final OnDeviceSubscriptionClient? client;
  @override
  State<SubscriptionPage> createState() => _SubscriptionPageState();
}

class _SubscriptionPageState extends State<SubscriptionPage> {
  late final _client = widget.client ?? OnDeviceSubscriptionClient();
  late Future<Map<String, Object?>> _future = _client.load();
  bool _busy = false;
  String? _message;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('订阅与试用')),
    body: FutureBuilder<Map<String, Object?>>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (isAccountAuthRequiredError(snapshot.error))
                AccountRequiredPanel(message: '请登录后查看订阅。', onReturn: _reload)
              else
                const Text('订阅或商店配置暂不可用。请稍后重试或恢复已有购买，无需重复购买。'),
              TextButton(
                onPressed: _busy ? null : _reload,
                child: const Text('重新核对'),
              ),
              OutlinedButton(
                onPressed: _busy ? null : () => _action(_client.restore),
                child: const Text('恢复购买'),
              ),
              if (_message != null) Text(_message!),
            ],
          );
        }
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final d = snapshot.requireData,
            e = d['entitlement'] as Map,
            p = d['product'] as Map;
        final eligible = p['trialEligible'] == true, end = e['expiresAtMs'];
        final needsSync = const [
          'verification_required',
          'billing_retry',
        ].contains(e['status']);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(
                e['valid'] == true
                    ? e['status'] == 'trialing'
                          ? '试用中'
                          : '订阅有效'
                    : '未订阅或已到期',
              ),
              subtitle: end is num
                  ? Text(
                      '有效至 ${DateTime.fromMillisecondsSinceEpoch(end.toInt()).toLocal()}',
                    )
                  : null,
            ),
            Text(
              eligible
                  ? '免费试用 7 天，之后 ${p['priceText']}/月'
                  : '${p['priceText']}/月',
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: _busy
                  ? null
                  : () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => OnDeviceResourcesPage(
                          config: AppConfig.fromEnvironment(),
                        ),
                      ),
                    ),
              child: const Text('先准备离线语言资源'),
            ),
            Text(
              eligible
                  ? '确认 Apple 自动续期订阅后开始试用。试用期结束后自动按人民币10元/月续费，除非提前在 Apple 订阅管理中取消。'
                  : '此 Apple 账号当前不享有免费试用。确认后按人民币10元/月订阅，并由 Apple 自动续期。',
            ),
            const Text('取消续订不会立即取消已获得的有效期。实际收费及到期时间以 Apple 确认页和已验证交易为准。'),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _busy || e['valid'] == true || needsSync
                  ? null
                  : () => _purchase(eligible),
              child: Text(
                _busy
                    ? '正在处理…'
                    : needsSync
                    ? '请先同步或恢复购买'
                    : eligible
                    ? '确认订阅并试用7天'
                    : '确认订阅 ¥10/月',
              ),
            ),
            OutlinedButton(
              onPressed: _busy ? null : () => _action(_client.restore),
              child: const Text('恢复购买'),
            ),
            TextButton(
              onPressed: _busy ? null : () => _action(_client.recoverPending),
              child: const Text('同步未完成购买'),
            ),
            TextButton(
              onPressed: _client.manage,
              child: const Text('Apple 订阅管理与取消'),
            ),
            for (final kind in const [
              ComplianceDocumentKind.privacy,
              ComplianceDocumentKind.terms,
            ])
              TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => ComplianceDocumentPage(
                      document: complianceDocuments.firstWhere(
                        (d) => d.kind == kind,
                      ),
                    ),
                  ),
                ),
                child: Text(
                  kind == ComplianceDocumentKind.privacy ? '隐私政策' : '用户协议',
                ),
              ),
            if (_message != null) Text(_message!),
          ],
        );
      },
    ),
  );
  void _reload() {
    if (mounted) setState(() => _future = _client.load());
  }

  Future<void> _purchase(bool eligible) async {
    final consent = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('确认自动续期订阅'),
        content: Text(
          eligible
              ? '先免费7天，试用结束后自动按¥10/月续订。是否继续打开 Apple 确认页？'
              : '当前不享有免费试用，将按¥10/月自动续订。是否继续打开 Apple 确认页？',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text('继续'),
          ),
        ],
      ),
    );
    if (consent != true || !mounted) return;
    await _action(
      () => _client.purchase(trialEligible: eligible, consent: true),
    );
  }

  Future<void> _action(Future<String> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final status = await action();
      if (!mounted) return;
      setState(() {
        _message = switch (status) {
          'cancelled' => '已取消，未开始新的订阅。',
          'pending' => '等待 Apple 处理，请勿重复购买。',
          _ => '已同步，请核对订阅状态。',
        };
        _future = _client.load();
      });
    } catch (_) {
      if (mounted) setState(() => _message = '操作未完成，保留原购买记录；请重试同步或恢复购买。');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
