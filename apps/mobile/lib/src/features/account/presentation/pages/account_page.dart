import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../data/account_api_client.dart';
import '../../data/account_session_store.dart';

class AccountPage extends StatefulWidget {
  const AccountPage({
    this.client,
    this.sessionStore,
    super.key,
  });

  final AccountApiClient? client;
  final AccountSessionStore? sessionStore;

  @override
  State<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends State<AccountPage> {
  late final AccountApiClient _client = widget.client ??
      AccountApiClient(baseUrl: AppConfig.fromEnvironment().apiBaseUrl);
  late final bool _ownsClient = widget.client == null;
  late final AccountSessionStore _sessionStore =
      widget.sessionStore ?? const FileAccountSessionStore();
  final _phoneController = TextEditingController();
  final _codeController = TextEditingController();
  AccountSession? _session;
  AccountProfile? _account;
  AccountExportData? _exportData;
  String? _message;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadSession();
  }

  @override
  void dispose() {
    _phoneController.dispose();
    _codeController.dispose();
    if (_ownsClient) _client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('账号与登录')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: <Widget>[
            const Text('在线同传、Call Link、支付和 AI 代打电话发布前需要账号归属。'),
            const SizedBox(height: 16),
            if (_loading) const LinearProgressIndicator(),
            if (_message != null) _StatusText(_message!),
            if (_error != null) _ErrorText(_errorMessage(_error!)),
            const SizedBox(height: 12),
            if (_account == null) _buildLoginForm() else _buildAccountPanel(),
          ],
        ),
      ),
    );
  }

  Widget _buildLoginForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        TextField(
          controller: _phoneController,
          decoration: const InputDecoration(labelText: '手机号'),
          keyboardType: TextInputType.phone,
          textInputAction: TextInputAction.next,
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _codeController,
          decoration: const InputDecoration(labelText: '验证码'),
          keyboardType: TextInputType.number,
          textInputAction: TextInputAction.done,
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 12,
          runSpacing: 8,
          children: <Widget>[
            OutlinedButton.icon(
              onPressed: _loading ? null : _requestCode,
              icon: const Icon(Icons.sms_outlined),
              label: const Text('获取验证码'),
            ),
            FilledButton.icon(
              onPressed: _loading ? null : _login,
              icon: const Icon(Icons.login),
              label: const Text('登录'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildAccountPanel() {
    final account = _account!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.account_circle_outlined),
          title: Text(account.phoneMasked),
          subtitle: Text('状态：${_statusText(account.status)}'),
        ),
        Text('账号 ID：${account.id}'),
        const SizedBox(height: 16),
        Wrap(
          spacing: 12,
          runSpacing: 8,
          children: <Widget>[
            OutlinedButton.icon(
              onPressed: _loading ? null : _exportAccount,
              icon: const Icon(Icons.download_outlined),
              label: const Text('导出个人信息副本'),
            ),
            OutlinedButton.icon(
              onPressed: _loading ? null : _logout,
              icon: const Icon(Icons.logout),
              label: const Text('退出登录'),
            ),
            FilledButton.icon(
              onPressed: _loading ? null : _confirmDeletion,
              icon: const Icon(Icons.delete_outline),
              label: const Text('注销账号'),
            ),
          ],
        ),
        if (_exportData != null) ...[
          const SizedBox(height: 16),
          _ExportSummary(data: _exportData!),
        ],
      ],
    );
  }

  Future<void> _loadSession() async {
    final session = await _sessionStore.load();
    if (!mounted) return;
    if (session == null) {
      setState(() => _loading = false);
      return;
    }
    setState(() {
      _session = session;
      _loading = true;
    });
    await _run(() async {
      _account = await _client.fetchMe(session.token);
    }, clearSessionOnAuthError: true);
  }

  Future<void> _requestCode() async {
    final phone = _phoneController.text.trim();
    await _run(() async {
      final challenge = await _client.requestPhoneCode(phone);
      _message = challenge.debugCode == null
          ? '验证码已发送至 ${challenge.phoneMasked}'
          : '开发验证码：${challenge.debugCode}';
    });
  }

  Future<void> _login() async {
    final phone = _phoneController.text.trim();
    final code = _codeController.text.trim();
    await _run(() async {
      final result = await _client.loginWithPhoneCode(phone: phone, code: code);
      final session = AccountSession(
        token: result.token,
        expiresAtIso: result.expiresAt.toIso8601String(),
      );
      await _sessionStore.save(session);
      _session = session;
      _account = result.account;
      _message = '登录成功';
    });
  }

  Future<void> _exportAccount() async {
    final token = _session?.token;
    if (token == null) return;
    await _run(() async {
      _exportData = await _client.exportData(token);
      _message = '个人信息副本已生成';
    }, clearSessionOnAuthError: true);
  }

  Future<void> _logout() async {
    final token = _session?.token;
    var remoteLogoutFailed = false;
    await _run(() async {
      if (token != null) {
        try {
          await _client.logout(token);
        } catch (_) {
          remoteLogoutFailed = true;
        }
      }
      await _clearLocalSession();
      _message = remoteLogoutFailed ? '已退出本机；服务器会话将在登录令牌到期后失效' : '已退出登录';
    });
  }

  Future<void> _confirmDeletion() async {
    final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('确认注销账号'),
            content: const Text('注销会影响余额、历史记录、术语库和 AI Agent 任务归属。'),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('取消'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('确认注销'),
              ),
            ],
          ),
        ) ??
        false;
    if (!confirmed) return;
    await _deleteAccount();
  }

  Future<void> _deleteAccount() async {
    final token = _session?.token;
    if (token == null) return;
    await _run(() async {
      await _client.requestDeletion(token);
      await _clearLocalSession();
      _message = '注销请求已提交，账号已退出';
    });
  }

  Future<void> _run(
    Future<void> Function() action, {
    bool clearSessionOnAuthError = false,
  }) async {
    setState(() {
      _loading = true;
      _error = null;
      _message = null;
    });
    try {
      await action();
    } catch (error) {
      if (clearSessionOnAuthError && _isAuthError(error)) {
        await _clearLocalSession();
      }
      _error = error;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _clearLocalSession() async {
    await _sessionStore.clear();
    _session = null;
    _account = null;
    _exportData = null;
  }

  bool _isAuthError(Object error) {
    return error is AccountApiException && error.message.contains('401');
  }

  String _errorMessage(Object error) {
    final text = error.toString();
    if (text.contains('network_timeout')) {
      return '网络请求超时，请确认手机可以访问无界AI服务。';
    }
    if (text.contains('network_error')) {
      return '网络连接失败，请检查网络和服务器地址。';
    }
    if (text.contains('/auth/phone/request-code')) return '验证码发送失败，请检查手机号';
    if (text.contains('/auth/phone/login')) return '登录失败，请检查验证码';
    if (text.contains('401')) return '登录已失效，请重新登录';
    return text.replaceFirst('Exception: ', '');
  }

  String _statusText(String status) {
    return switch (status) {
      'active' => '正常',
      'deletion_requested' => '注销处理中',
      'deleted' => '已注销',
      _ => status,
    };
  }
}

class _StatusText extends StatelessWidget {
  const _StatusText(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(text,
        style: TextStyle(color: Theme.of(context).colorScheme.primary));
  }
}

class _ErrorText extends StatelessWidget {
  const _ErrorText(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(text,
        style: TextStyle(color: Theme.of(context).colorScheme.error));
  }
}

class _ExportSummary extends StatelessWidget {
  const _ExportSummary({required this.data});

  final AccountExportData data;

  @override
  Widget build(BuildContext context) {
    return SelectableText(
      '导出时间：${data.exportedAt.toLocal()}\n'
      '历史会话：${data.sessionCount}\n'
      '账单记录：${data.ledgerCount}\n'
      '术语：${data.termCount}\n'
      'AI Agent 任务：${data.agentCallCount}\n'
      '同意记录：${data.consentCount}',
    );
  }
}
