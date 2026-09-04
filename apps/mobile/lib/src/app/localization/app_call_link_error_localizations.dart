String? appCallLinkErrorMessage(String message) {
  if (message.startsWith('Create call link failed')) {
    return '创建通话失败，请稍后重试';
  }
  if (message.startsWith('Get call link failed')) {
    return '加载通话失败，请稍后重试';
  }
  if (message.startsWith('Create room token failed')) {
    return '准备通话失败，请稍后重试';
  }
  if (message.startsWith('Confirm room connection failed')) {
    return '确认通话连接失败，请重新进入房间';
  }
  if (message.startsWith('Rotate guest ticket failed')) {
    return '邀请链接刷新失败，请稍后重试';
  }
  if (message.startsWith('End call link failed')) {
    return '结束并保存通话失败';
  }
  return null;
}
