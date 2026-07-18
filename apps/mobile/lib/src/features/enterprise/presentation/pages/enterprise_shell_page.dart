import 'package:flutter/material.dart';

import '../../data/enterprise_mobile_api_client.dart';
import '../../data/enterprise_mobile_models.dart';
import 'enterprise_alerts_page.dart';
import 'enterprise_dashboard_page.dart';
import 'enterprise_meetings_page.dart';
import 'enterprise_profile_page.dart';
import 'enterprise_takeover_page.dart';

class EnterpriseShellPage extends StatefulWidget {
  const EnterpriseShellPage({
    required this.client,
    required this.workspace,
    required this.onSwitchTenant,
    required this.onManageAccount,
    super.key,
  });

  final EnterpriseMobileApiClient client;
  final EnterpriseMobileWorkspace workspace;
  final VoidCallback onSwitchTenant;
  final VoidCallback onManageAccount;

  @override
  State<EnterpriseShellPage> createState() => _EnterpriseShellPageState();
}

class _EnterpriseShellPageState extends State<EnterpriseShellPage> {
  int _selectedIndex = 0;

  @override
  Widget build(BuildContext context) {
    final destinations = _destinations();
    if (_selectedIndex >= destinations.length) _selectedIndex = 0;
    final selected = destinations[_selectedIndex];
    return Scaffold(
      appBar: AppBar(
        title: Text(selected.label),
        actions: <Widget>[
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 160),
              child: Center(
                child: Text(
                  widget.workspace.context.tenant.name,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: IndexedStack(
          index: _selectedIndex,
          children: destinations.map((item) => item.page).toList(),
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) =>
            setState(() => _selectedIndex = index),
        destinations: destinations
            .map(
              (item) => NavigationDestination(
                icon: Icon(item.icon),
                selectedIcon: Icon(item.selectedIcon),
                label: item.label,
              ),
            )
            .toList(growable: false),
      ),
    );
  }

  List<_EnterpriseDestination> _destinations() {
    final workspace = widget.workspace;
    return <_EnterpriseDestination>[
      _EnterpriseDestination(
        label: '工作台',
        icon: Icons.dashboard_outlined,
        selectedIcon: Icons.dashboard,
        page: EnterpriseDashboardPage(workspace: workspace),
      ),
      if (workspace.context.can('meeting:read'))
        _EnterpriseDestination(
          label: '会议',
          icon: Icons.groups_outlined,
          selectedIcon: Icons.groups,
          page: EnterpriseMeetingsPage(
            client: widget.client,
            workspace: workspace,
          ),
        ),
      if (workspace.context.can('support:takeover'))
        _EnterpriseDestination(
          label: '接管',
          icon: Icons.pan_tool_alt_outlined,
          selectedIcon: Icons.pan_tool_alt,
          page: EnterpriseTakeoverPage(workspace: workspace),
        ),
      _EnterpriseDestination(
        label: '告警',
        icon: Icons.notifications_outlined,
        selectedIcon: Icons.notifications,
        page: EnterpriseAlertsPage(workspace: workspace),
      ),
      _EnterpriseDestination(
        label: '我的',
        icon: Icons.person_outline,
        selectedIcon: Icons.person,
        page: EnterpriseProfilePage(
          workspace: workspace,
          onSwitchTenant: widget.onSwitchTenant,
          onManageAccount: widget.onManageAccount,
        ),
      ),
    ];
  }
}

class _EnterpriseDestination {
  const _EnterpriseDestination({
    required this.label,
    required this.icon,
    required this.selectedIcon,
    required this.page,
  });

  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final Widget page;
}
