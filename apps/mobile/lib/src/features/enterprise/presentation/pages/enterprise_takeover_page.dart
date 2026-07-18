import 'package:flutter/material.dart';

import '../../data/enterprise_mobile_models.dart';
import '../widgets/enterprise_mobile_status_panel.dart';

class EnterpriseTakeoverPage extends StatelessWidget {
  const EnterpriseTakeoverPage({required this.workspace, super.key});

  final EnterpriseMobileWorkspace workspace;

  @override
  Widget build(BuildContext context) {
    final allowed = workspace.context.can('support:takeover');
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: <Widget>[
        EnterpriseMobileStatusPanel(
          status: allowed
              ? EnterpriseMobileStatus.notReady
              : EnterpriseMobileStatus.forbidden,
          title: allowed ? '企业接管队列尚未接入' : null,
          description: allowed
              ? '当前不复用个人 AI 代打接管接口。tenant-scoped 队列、授权证据和 '
                  'Worker ticket 接通后再允许人工接管。'
              : '当前成员缺少 support:takeover，未读取或执行任何接管操作。',
        ),
      ],
    );
  }
}
