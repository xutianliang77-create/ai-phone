import 'package:flutter/material.dart';

import '../../data/enterprise_mobile_models.dart';
import '../widgets/enterprise_mobile_status_panel.dart';

class EnterpriseMeetingsPage extends StatelessWidget {
  const EnterpriseMeetingsPage({required this.workspace, super.key});

  final EnterpriseMobileWorkspace workspace;

  @override
  Widget build(BuildContext context) {
    if (!workspace.context.can('meeting:read')) {
      return const _PageBody(
        child: EnterpriseMobileStatusPanel(
          status: EnterpriseMobileStatus.forbidden,
          description: '当前成员缺少 meeting:read，未读取企业会议。',
        ),
      );
    }
    return const _PageBody(
      child: EnterpriseMobileStatusPanel(
        status: EnterpriseMobileStatus.notReady,
        title: '企业会议列表尚未接入',
        description: '当前不回退到个人同传或 Call Link。会议 API 完成 tenant/route '
            '绑定后再开放加入、主持和共享入口。',
      ),
    );
  }
}

class _PageBody extends StatelessWidget {
  const _PageBody({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: <Widget>[child],
    );
  }
}
