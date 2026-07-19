import 'package:flutter/material.dart';

import '../../data/enterprise_mobile_models.dart';
import '../widgets/enterprise_mobile_status_panel.dart';

class EnterpriseAlertsPage extends StatelessWidget {
  const EnterpriseAlertsPage({required this.workspace, super.key});

  final EnterpriseMobileWorkspace workspace;

  @override
  Widget build(BuildContext context) {
    final alerts = <_EnterpriseAlert>[
      if (workspace.context.tenant.status != 'active')
        _EnterpriseAlert(
          '租户状态',
          '当前状态为 ${workspace.context.tenant.status}，新业务保持阻断。',
        ),
      ...workspace.providers
          .where((provider) => provider.status != 'ready')
          .map(
            (provider) => _EnterpriseAlert(
              _capabilityLabel(provider.capability),
              '${_statusLabel(provider.status)}'
              '${provider.reasonCode == null ? '' : ' · ${provider.reasonCode}'}',
            ),
          ),
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: <Widget>[
        if (alerts.isEmpty)
          const EnterpriseMobileStatusPanel(
            status: EnterpriseMobileStatus.empty,
            title: '当前没有可判定告警',
            description: '只表示已读取的 tenant/provider 真值未产生告警；未接入数据不计为正常。',
          )
        else
          ...alerts.map(
            (alert) => Card(
              child: ListTile(
                leading: Icon(
                  Icons.warning_amber_outlined,
                  color: Theme.of(context).colorScheme.error,
                ),
                title: Text(alert.title),
                subtitle: Text(alert.detail),
              ),
            ),
          ),
      ],
    );
  }
}

class _EnterpriseAlert {
  const _EnterpriseAlert(this.title, this.detail);

  final String title;
  final String detail;
}

String _capabilityLabel(String capability) => switch (capability) {
      'pstn.outbound' => '外呼 Provider',
      'crm.sync' => 'CRM 同步',
      'calendar.meetings' => '企业日历',
      'channel.messaging' => '消息渠道',
      'screen.ocr' => '共享内容 OCR',
      _ => capability,
    };

String _statusLabel(String status) => switch (status) {
      'not_configured' => '未配置',
      'not_ready' => '未就绪',
      'degraded' => '已降级',
      'checking' => '检查中',
      _ => status,
    };
