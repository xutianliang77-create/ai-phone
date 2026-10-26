String? deviceLicenseFailureText(Object error) {
  final text = error.toString();
  if (text.contains('v10_entitlement_billing_retry') || text.contains('v10_entitlement_verification_required')) {
    return '订阅状态需要核对，请同步或恢复购买，无需重复付款。';
  }
  if (text.contains('v10_entitlement_not_subscribed')) return '尚未订阅，请购买或恢复订阅。';
  if (text.contains('v10_entitlement_expired') ||
      text.contains('v10_entitlement_revoked')) {
    return '套餐已到期或已撤销，请购买、恢复订阅或核对 Apple 订阅状态。';
  }
  if (text.contains('v10_auth_required') ||
      text.contains('device_account_required')) {
    return '需要先登录账号';
  }
  if (text.contains('license_admission_closed') ||
      text.contains('configuration_closed')) {
    return '当前授权服务未开放，请稍后重试。';
  }
  if (text.contains('authorization_required') ||
      text.contains('PlatformException(expired,')) {
    return '本次离线授权已到期，请联网更新授权。';
  }
  return null;
}
