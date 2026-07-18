import 'package:flutter/material.dart';

import '../../data/enterprise_mobile_models.dart';

class EnterpriseProfilePage extends StatelessWidget {
  const EnterpriseProfilePage({
    required this.workspace,
    required this.onSwitchTenant,
    required this.onManageAccount,
    super.key,
  });

  final EnterpriseMobileWorkspace workspace;
  final VoidCallback onSwitchTenant;
  final VoidCallback onManageAccount;

  @override
  Widget build(BuildContext context) {
    final contextValue = workspace.context;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: <Widget>[
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  contextValue.tenant.name,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                Text('角色：${contextValue.member.role}'),
                Text('成员状态：${contextValue.member.status}'),
                Text('区域：${contextValue.tenant.homeRegion}'),
                Text('Cell：${workspace.route.cellId}'),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: onSwitchTenant,
          icon: const Icon(Icons.domain_outlined),
          label: const Text('切换企业'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: onManageAccount,
          icon: const Icon(Icons.manage_accounts_outlined),
          label: const Text('账号与登录'),
        ),
        const SizedBox(height: 20),
        Text('当前 scopes', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: contextValue.scopes
              .map((scope) => Chip(label: Text(scope)))
              .toList(growable: false),
        ),
      ],
    );
  }
}
