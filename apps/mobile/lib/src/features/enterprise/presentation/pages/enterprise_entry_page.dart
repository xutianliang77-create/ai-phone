import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../account/data/account_session_store.dart';
import '../../../account/presentation/pages/account_page.dart';
import '../../data/enterprise_mobile_api_client.dart';
import '../../data/enterprise_mobile_models.dart';
import '../../data/enterprise_tenant_selection_store.dart';
import '../widgets/enterprise_entry_failure.dart';
import '../widgets/enterprise_mobile_status_panel.dart';
import 'enterprise_shell_page.dart';

class EnterpriseEntryPage extends StatefulWidget {
  const EnterpriseEntryPage({
    required this.config,
    this.client,
    this.sessionStore,
    this.selectionStore,
    super.key,
  });

  final AppConfig config;
  final EnterpriseMobileApiClient? client;
  final AccountSessionStore? sessionStore;
  final EnterpriseTenantSelectionStore? selectionStore;

  @override
  State<EnterpriseEntryPage> createState() => _EnterpriseEntryPageState();
}

class _EnterpriseEntryPageState extends State<EnterpriseEntryPage> {
  late final EnterpriseMobileApiClient _client = widget.client ??
      EnterpriseMobileApiClient(baseUrl: widget.config.apiBaseUrl);
  late final bool _ownsClient = widget.client == null;
  late final AccountSessionStore _sessionStore =
      widget.sessionStore ?? const FileAccountSessionStore();
  late final EnterpriseTenantSelectionStore _selectionStore =
      widget.selectionStore ?? const FileEnterpriseTenantSelectionStore();

  AccountSession? _session;
  List<EnterpriseMobileMembership> _memberships = const [];
  EnterpriseMobileWorkspace? _workspace;
  String? _selectedTenantId;
  EnterpriseEntryFailure? _failure;
  bool _loading = true;
  bool _needsLogin = false;
  bool _forceSelection = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    if (_ownsClient) _client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final workspace = _workspace;
    if (workspace != null) {
      return EnterpriseShellPage(
        client: _client,
        workspace: workspace,
        onSwitchTenant: _switchTenant,
        onManageAccount: _openAccount,
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('企业工作区')),
      body: SafeArea(child: _buildEntryBody()),
    );
  }

  Widget _buildEntryBody() {
    if (_loading) {
      return const _EntryList(
        child: EnterpriseMobileStatusPanel(
          status: EnterpriseMobileStatus.loading,
          description: '正在重新校验账号、企业成员关系、路由和权限。',
        ),
      );
    }
    if (_needsLogin) {
      return _EntryList(
        child: EnterpriseMobileStatusPanel(
          status: EnterpriseMobileStatus.forbidden,
          title: '需要登录',
          description: '企业工作区不使用离线账号或过期会话。登录后将重新读取企业权限。',
          action: FilledButton.icon(
            onPressed: _openAccount,
            icon: const Icon(Icons.login),
            label: const Text('账号与登录'),
          ),
        ),
      );
    }
    final failure = _failure;
    if (failure != null) {
      return _EntryList(
        child: EnterpriseMobileStatusPanel(
          status: failure.status,
          title: failure.title,
          description: failure.description,
          traceId: failure.traceId,
          action: OutlinedButton.icon(
            onPressed: _reload,
            icon: const Icon(Icons.refresh),
            label: const Text('重新校验'),
          ),
        ),
      );
    }
    if (_memberships.isEmpty) {
      return const _EntryList(
        child: EnterpriseMobileStatusPanel(
          status: EnterpriseMobileStatus.forbidden,
          title: '没有可用企业',
          description: '当前账号没有 active 成员关系，请联系企业管理员。',
        ),
      );
    }
    return _buildTenantPicker();
  }

  Widget _buildTenantPicker() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: <Widget>[
        Text('选择企业', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        const Text('进入前会重新校验 tenant、region、cell、签名路由和 scope。'),
        const SizedBox(height: 16),
        RadioGroup<String>(
          groupValue: _selectedTenantId,
          onChanged: (value) => setState(() => _selectedTenantId = value),
          child: Column(
            children: _memberships.map((membership) {
              final tenant = membership.tenant;
              final available = tenant.status == 'active' &&
                  membership.member.status == 'active' &&
                  tenant.cellId != null;
              return Card(
                child: RadioListTile<String>(
                  value: tenant.id,
                  enabled: available,
                  title: Text(tenant.name),
                  subtitle: Text(
                    '${enterpriseRoleLabel(membership.member.role)} · '
                    '${tenant.homeRegion} · '
                    '${available ? tenant.planCode : enterpriseTenantStatus(tenant.status)}',
                  ),
                  secondary: Icon(
                    available ? Icons.domain_outlined : Icons.block_outlined,
                  ),
                ),
              );
            }).toList(growable: false),
          ),
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _selectedTenantId == null ? null : _enterSelectedTenant,
          icon: const Icon(Icons.login),
          label: const Text('进入企业工作区'),
        ),
      ],
    );
  }

  Future<void> _reload() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _failure = null;
        _needsLogin = false;
        _workspace = null;
      });
    }
    final session = await _sessionStore.load();
    if (!mounted) return;
    if (!_validSession(session)) {
      await _clearLocalEnterpriseState(clearSession: session != null);
      if (!mounted) return;
      setState(() {
        _session = null;
        _memberships = const [];
        _selectedTenantId = null;
        _needsLogin = true;
        _loading = false;
      });
      return;
    }
    try {
      final memberships = await _client.listTenants(session!.token);
      if (!mounted) return;
      final storedTenantId =
          _forceSelection ? null : await _selectionStore.load();
      if (!mounted) return;
      final resumable = memberships.where(
        (item) => item.tenant.id == storedTenantId && _canEnter(item),
      );
      setState(() {
        _session = session;
        _memberships = memberships;
        _selectedTenantId =
            memberships.length == 1 && _canEnter(memberships.first)
                ? memberships.first.tenant.id
                : null;
        _loading = false;
      });
      if (resumable.isNotEmpty) {
        await _activate(resumable.first);
      } else if (!_forceSelection &&
          memberships.length == 1 &&
          _canEnter(memberships.first)) {
        await _activate(memberships.first);
      }
    } on EnterpriseMobileApiException catch (error) {
      await _handleApiFailure(error);
    } catch (_) {
      _showFailure(const EnterpriseEntryFailure.contextRejected());
    }
  }

  Future<void> _enterSelectedTenant() async {
    final selected = _memberships.where(
      (item) => item.tenant.id == _selectedTenantId,
    );
    if (selected.isEmpty) return;
    await _activate(selected.first);
  }

  Future<void> _activate(EnterpriseMobileMembership membership) async {
    final session = _session;
    if (session == null || !_canEnter(membership)) {
      _showFailure(const EnterpriseEntryFailure.tenantNotReady());
      return;
    }
    setState(() {
      _loading = true;
      _failure = null;
    });
    try {
      final workspace = await _client.loadWorkspace(
        token: session.token,
        membership: membership,
      );
      await _selectionStore.save(membership.tenant.id);
      if (!mounted) return;
      setState(() {
        _workspace = workspace;
        _loading = false;
        _forceSelection = false;
      });
    } on EnterpriseMobileApiException catch (error) {
      await _handleApiFailure(error);
    } catch (_) {
      _showFailure(const EnterpriseEntryFailure.contextRejected());
    }
  }

  Future<void> _handleApiFailure(EnterpriseMobileApiException error) async {
    if (error.isAuthenticationFailure) {
      await _clearLocalEnterpriseState(clearSession: true);
      if (!mounted) return;
      setState(() {
        _session = null;
        _memberships = const [];
        _selectedTenantId = null;
        _needsLogin = true;
        _loading = false;
      });
      return;
    }
    final failure = switch (error.code) {
      'network_timeout' ||
      'network_error' =>
        EnterpriseEntryFailure.network(error.traceId),
      'tenant_context_mismatch' ||
      'invalid_response' =>
        EnterpriseEntryFailure.contextRejected(error.traceId),
      _ => EnterpriseEntryFailure.service(error.traceId),
    };
    _showFailure(failure);
  }

  void _showFailure(EnterpriseEntryFailure failure) {
    if (!mounted) return;
    setState(() {
      _failure = failure;
      _workspace = null;
      _loading = false;
    });
  }

  Future<void> _openAccount() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => AccountPage(sessionStore: _sessionStore),
      ),
    );
    if (mounted) await _reload();
  }

  Future<void> _switchTenant() async {
    await _selectionStore.clear();
    if (!mounted) return;
    setState(() {
      _workspace = null;
      _selectedTenantId = null;
      _forceSelection = true;
    });
    await _reload();
  }

  Future<void> _clearLocalEnterpriseState({required bool clearSession}) async {
    await _selectionStore.clear();
    if (clearSession) await _sessionStore.clear();
  }

  bool _validSession(AccountSession? session) {
    if (session == null || session.token.trim().isEmpty) return false;
    final expiresAt = DateTime.tryParse(session.expiresAtIso);
    return expiresAt != null && expiresAt.isAfter(DateTime.now());
  }

  bool _canEnter(EnterpriseMobileMembership membership) {
    return membership.tenant.status == 'active' &&
        membership.member.status == 'active' &&
        membership.tenant.cellId != null;
  }
}

class _EntryList extends StatelessWidget {
  const _EntryList({required this.child});

  final Widget child;
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: <Widget>[child],
    );
  }
}
