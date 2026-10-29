import 'dart:async';
import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../data/account_api_client.dart';
import '../../data/account_session_store.dart';
import '../../data/apple_identity_client.dart';
import '../../data/deletion_receipt_store.dart';
import '../../../compliance/presentation/widgets/apple_account_agreements.dart';

part 'account_page_login.dart';

class AccountPage extends StatefulWidget {
  const AccountPage({
    this.client,
    this.sessionStore,
    this.config,
    this.appleIdentity,
    this.deletionReceipts,
    super.key,
  });

  final AccountApiClient? client;
  final AccountSessionStore? sessionStore;
  final AppConfig? config;
  final AppleIdentityClient? appleIdentity;
  final DeletionReceiptStorage? deletionReceipts;

  @override
  State<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends State<AccountPage> {
  late final AccountApiClient _client =
      widget.client ??
      AccountApiClient(
        baseUrl:
            (widget.config ?? AppConfig.fromEnvironment()).accountApiBaseUrl,
      );
  late final bool _ownsClient = widget.client == null;
  late final AccountSessionStore _sessionStore =
      widget.sessionStore ?? _client.createSessionStore();
  late final DeletionReceiptStorage? _deletionReceipts = widget.deletionReceipts ??
      (onDeviceExecution ? KeychainDeletionReceiptStore(baseUrl:_client.baseUrl,deploymentId:_client.deploymentId) : null);
  final _phoneController = TextEditingController();
  final _codeController = TextEditingController();
  AccountSession? _session;
  AccountProfile? _account;
  AccountExportData? _exportData;
  String? _message;
  Object? _error;
  bool _loading = true;
  bool _checkingDeletion = false;
  List<DeletionReceipt> _receipts = const [];
  final Map<String,String> _receiptStates = {};

  @override
  void initState() {
    super.initState();
    _loadSession();
    if (_deletionReceipts != null) unawaited(_refreshDeletionReceipts());
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
            const Text('登录后可查看账号、授权状态和个人信息。'),
            const SizedBox(height: 16),
            if (_loading) const LinearProgressIndicator(),
            if (_message != null) _StatusText(_message!),
            if (_error != null) _ErrorText(_errorMessage(_error!)),
            const SizedBox(height: 12),
            if (_account == null) _buildLoginForm() else _buildAccountPanel(),
            if (_receipts.isNotEmpty) ...[
              const SizedBox(height:24),
              const Text('账号注销进度'),
              const Text('进度凭据只保存在这台设备，可在提交后 7 天内查询；它不能登录账号。'),
              for (final receipt in _receipts)
                ListTile(title:Text('提交时间 ${receipt.createdAt.toLocal()}'),
                  subtitle:Text(_receiptStates[receipt.secret] ?? '等待核对'),
                  trailing:TextButton(onPressed:()=>_removeDeletionReceipt(receipt),child:const Text('移除'))),
              TextButton(onPressed:_checkingDeletion?null:_refreshDeletionReceipts,
                child:Text(_checkingDeletion?'正在核对…':'刷新注销进度')),
            ],
          ],
        ),
      ),
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
          title: Text(
            account.phoneMasked.isEmpty ? 'Apple 账号' : account.phoneMasked,
          ),
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
      if (_client.deploymentId.isNotEmpty) await _clearLocalSession();
      if (token != null) {
        try {
          await _client.logout(token);
        } catch (_) {
          remoteLogoutFailed = true;
        }
      }
      if (_client.deploymentId.isEmpty) await _clearLocalSession();
      _message = remoteLogoutFailed ? '已退出本机；服务器会话将在登录令牌到期后失效' : '已退出登录';
    });
  }

  Future<void> _confirmDeletion() async {
    final confirmed =
        await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('确认注销账号'),
            content: const Text(onDeviceExecution ? '注销后此账号不能继续领取授权，请先导出所需记录。注销不会取消 Apple 自动续期订阅，请在 Apple 订阅管理中另行取消。本机记录和已有备份会保留，不会自动归属其他账号；如需删除可在记录页操作。此设备将保留最多 7 天的只读注销进度凭据。' : '注销会影响余额、历史记录、术语库和 AI Agent 任务归属。'),
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
      if(onDeviceExecution){
        final store=_deletionReceipts;
        if(store==null)throw StateError('deletion_receipt_storage_unavailable');
        final receipt=await store.create();
        try {await _client.requestDeviceDeletion(token,receiptHash:receipt.receiptHash);}
        finally {unawaited(_refreshDeletionReceipts());}
      }else{
        await _client.requestDeletion(token);
      }
      await _clearLocalSession();
      _message = onDeviceExecution
          ? '注销请求已提交，账号已退出。Apple 授权撤销与账号清理仍在处理；取消订阅需在 Apple 订阅管理中另行操作。'
          : '注销请求已提交，账号已退出';
      if(onDeviceExecution)unawaited(_refreshDeletionReceipts());
    });
  }

  Future<void> _refreshDeletionReceipts() async {
    final store=_deletionReceipts;
    if(store==null||_checkingDeletion)return;
    if(mounted)setState(()=>_checkingDeletion=true);
    try {
      final receipts=await store.load();
      if(!mounted)return;
      setState(()=>_receipts=receipts);
      for(final receipt in receipts){
        String message;
        try{
          final result=await _client.deletionStatus(receipt.secret);
          message=switch(result['status']){
            'completed' when result['appleRevocation']=='manual_required' =>
              '账号身份已注销，必要账务凭证按隐私政策保留；请在 Apple 账号的“使用 Apple 登录的 App”设置中手动停止使用无界 AI。订阅须另行取消。',
            'completed' => '账号身份已注销且 Apple 登录授权已撤销，必要账务凭证按隐私政策保留；订阅须另行取消。',
            'review_required' => '注销需要进一步核对，请联系支持。',
            'not_submitted' => '未查到已提交的注销请求；请登录后核对账号状态。',
            _ => '注销处理中。',
          };
        }catch(_){message='暂时无法核对，或查询凭据已过期。';}
        if(!mounted)return;
        setState(()=>_receiptStates[receipt.secret]=message);
      }
    }catch(_){
      if(mounted)setState(()=>_message='注销进度凭据暂不可读取；请稍后重试。');
    }finally{if(mounted)setState(()=>_checkingDeletion=false);}
  }

  Future<void> _removeDeletionReceipt(DeletionReceipt receipt) async {
    final confirmed=await showDialog<bool>(context:context,builder:(c)=>AlertDialog(
      title:const Text('移除注销进度'),content:const Text('移除后将无法在这台设备查看该请求的进度，不影响账号注销或本机历史记录。'),
      actions:[TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('取消')),
        FilledButton(onPressed:()=>Navigator.pop(c,true),child:const Text('确认移除'))]));
    if(confirmed!=true||!mounted)return;
    try{await _deletionReceipts?.remove(receipt.secret);if(mounted)await _refreshDeletionReceipts();}
    catch(_){if(mounted)setState(()=>_message='注销进度凭据未能移除，请重试。');}
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
    if (_client.deploymentId.isNotEmpty) return '账号操作未完成，请稍后重试；如持续失败请联系支持。';
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
    return Text(
      text,
      style: TextStyle(color: Theme.of(context).colorScheme.primary),
    );
  }
}

class _ErrorText extends StatelessWidget {
  const _ErrorText(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(color: Theme.of(context).colorScheme.error),
    );
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
