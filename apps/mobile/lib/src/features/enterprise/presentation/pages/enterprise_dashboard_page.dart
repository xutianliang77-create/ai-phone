import 'package:flutter/material.dart';

import '../../data/enterprise_mobile_models.dart';
import '../widgets/enterprise_mobile_status_panel.dart';

class EnterpriseDashboardPage extends StatelessWidget {
  const EnterpriseDashboardPage({required this.workspace, super.key});

  final EnterpriseMobileWorkspace workspace;

  @override
  Widget build(BuildContext context) {
    final tenant = workspace.context.tenant;
    final readyProviders = workspace.providers
        .where((provider) => provider.status == 'ready')
        .length;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: <Widget>[
        Text(tenant.name, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 4),
        Text(
          '${tenant.homeRegion} · ${workspace.route.cellId}',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.outline,
              ),
        ),
        const SizedBox(height: 20),
        _TruthCard(
          icon: Icons.verified_user_outlined,
          label: '企业身份',
          value: _tenantStatus(tenant.status),
          detail: '${_roleLabel(workspace.context.member.role)} · '
              'route epoch ${workspace.route.routeEpoch}',
        ),
        _TruthCard(
          icon: Icons.hub_outlined,
          label: 'Provider 就绪',
          value: '$readyProviders/${workspace.providers.length}',
          detail: '只统计服务端 capability document 的 ready 状态',
        ),
        _TruthCard(
          icon: Icons.policy_outlined,
          label: '移动端权限',
          value: '${workspace.context.scopes.length} 个 scope',
          detail: '入口隐藏不替代服务端授权',
        ),
        const SizedBox(height: 8),
        if (tenant.status != 'active')
          const EnterpriseMobileStatusPanel(
            status: EnterpriseMobileStatus.notReady,
            description: '当前租户不是 active，新业务入口保持阻断。',
          )
        else
          const EnterpriseMobileStatusPanel(
            status: EnterpriseMobileStatus.empty,
            title: '当前没有可判定待办',
            description: '未授权或尚未接入的数据不会被计为正常。',
          ),
      ],
    );
  }
}

class _TruthCard extends StatelessWidget {
  const _TruthCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.detail,
  });

  final IconData icon;
  final String label;
  final String value;
  final String detail;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(icon, color: Theme.of(context).colorScheme.primary),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(label, style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 4),
                  Text(value, style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 4),
                  Text(detail, style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _tenantStatus(String status) => switch (status) {
      'active' => '可用',
      'suspended' => '已暂停',
      'provisioning' => '开通中',
      'provisioning_failed' => '开通失败',
      'deletion_requested' => '删除处理中',
      'deleted' => '已删除',
      _ => status,
    };

String _roleLabel(String role) => switch (role) {
      'owner' => '所有者',
      'admin' => '管理员',
      'marketing_manager' => '营销主管',
      'marketing_member' => '营销成员',
      'support_manager' => '客服主管',
      'support_agent' => '客服坐席',
      'meeting_host' => '会议主持人',
      'member' => '企业成员',
      'auditor' => '审计员',
      _ => role,
    };
