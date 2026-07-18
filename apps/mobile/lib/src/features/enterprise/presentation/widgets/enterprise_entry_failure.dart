import 'enterprise_mobile_status_panel.dart';

class EnterpriseEntryFailure {
  const EnterpriseEntryFailure({
    required this.status,
    required this.title,
    required this.description,
    this.traceId,
  });

  const EnterpriseEntryFailure.network([String? traceId])
      : this(
          status: EnterpriseMobileStatus.failed,
          title: '企业服务暂不可达',
          description: '未进入工作区，也未使用本地缓存显示成功状态。请恢复网络后重试。',
          traceId: traceId,
        );

  const EnterpriseEntryFailure.contextRejected([String? traceId])
      : this(
          status: EnterpriseMobileStatus.forbidden,
          title: '企业上下文校验失败',
          description: '成员关系、租户或签名路由不一致，已拒绝进入工作区。',
          traceId: traceId,
        );

  const EnterpriseEntryFailure.tenantNotReady()
      : this(
          status: EnterpriseMobileStatus.notReady,
          title: '企业尚未就绪',
          description: '租户、成员或 Cell 未处于可用状态，未进入工作区。',
        );

  const EnterpriseEntryFailure.service([String? traceId])
      : this(
          status: EnterpriseMobileStatus.failed,
          title: '企业服务校验失败',
          description: '服务端未确认当前企业上下文，未进入工作区。',
          traceId: traceId,
        );

  final EnterpriseMobileStatus status;
  final String title;
  final String description;
  final String? traceId;
}

String enterpriseTenantStatus(String status) => switch (status) {
      'active' => '可用',
      'suspended' => '已暂停',
      'provisioning' => '开通中',
      'provisioning_failed' => '开通失败',
      'deletion_requested' => '删除处理中',
      'deleted' => '已删除',
      _ => status,
    };

String enterpriseRoleLabel(String role) => switch (role) {
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
