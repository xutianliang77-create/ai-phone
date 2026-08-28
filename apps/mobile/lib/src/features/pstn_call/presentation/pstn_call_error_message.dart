import '../../account/data/account_auth_headers.dart';
import '../../call_link/data/call_link_api_client.dart';

String pstnCallErrorMessage(Object error, {required bool chinese}) {
  if (error is AccountAuthRequiredException) {
    return _text(chinese, '请先登录账号后再拨打。', 'Sign in before placing a call.');
  }
  final apiError = error is CallLinkApiException ? error : null;
  switch (apiError?.code) {
    case 'auth_required':
      return _text(chinese, '登录已过期，请重新登录后再试。',
          'Your session expired. Sign in and try again.');
    case 'account_forbidden':
      return _text(
          chinese, '当前账号不能操作这次通话。', 'This account cannot control the call.');
    case 'air780_translation_not_ready':
    case 'call_room_worker_unavailable':
    case 'call_room_start_failed':
      return _text(chinese, '通话翻译服务正在恢复，请稍后重试。',
          'The call translation service is recovering. Try again shortly.');
    case 'phone_host_not_connected':
    case 'sip_host_not_connected':
      return _text(chinese, '通话房间尚未连接，请等待恢复后再拨打。',
          'The call room is not connected yet. Wait for it to recover.');
    case 'air780_outbound_failed':
      return _text(chinese, 'Air780 未接受本次拨号；系统不会自动重拨，请检查设备、SIM 和网络后重试。',
          'Air780 did not accept the call. It will not redial automatically; check the device, SIM, and network.');
    case 'air780_hangup_failed':
    case 'air780_hangup_not_dispatched':
      return _text(chinese, '挂断命令未送达，电话可能仍在进行，请再次点击“结束通话”。',
          'The hangup command was not delivered. The call may still be active; tap End call again.');
    case 'air780_call_binding_missing':
      return _text(chinese, '电话绑定正在恢复；请勿重新拨号，稍后重试挂断。',
          'The phone binding is recovering. Do not redial; retry hangup shortly.');
    case 'air780_hangup_operation_conflict':
      return _text(chinese, '挂断状态正在对账，请等待电话线路结束。',
          'Hangup is being reconciled. Wait for the carrier line to end.');
    case 'air780_outbound_operation_conflict':
    case 'phone_outbound_operation_conflict':
    case 'sip_guest_already_connected':
      return _text(chinese, '本次会话已有电话任务，请勿重复拨号。',
          'This session already has a phone call. Do not redial.');
    case 'air780_outbound_missing':
    case 'air780_call_not_active':
    case 'sip_outbound_missing':
    case 'sip_call_not_active':
      return _text(chinese, '电话线路已结束或尚未建立。',
          'The carrier call has ended or was not established.');
    case 'call_link_not_found':
    case 'call_link_expired':
      return _text(chinese, '本次通话会话已失效，请返回后重新开始。',
          'This call session expired. Go back and start again.');
    case 'invalid_air780_outbound_request':
    case 'air780_initial_dtmf_unsupported':
      return _text(chinese, '拨号参数不受支持，请重新检查号码和语言。',
          'The dialing request is unsupported. Check the number and languages.');
    case 'sip_dtmf_unavailable':
    case 'phone_dtmf_unavailable':
    case 'phone_dtmf_invalid':
      return _text(
          chinese, '当前电话不支持拨号按键。', 'The keypad is unavailable for this call.');
    case 'air780_dtmf_not_connected':
      return _text(chinese, '电话接通后才能发送拨号按键。',
          'Wait for the carrier call to connect before using the keypad.');
    case 'air780_dtmf_not_dispatched':
      return _text(chinese, '拨号按键尚未送达；系统会复用同一命令重试，不会重复按键。',
          'The keypad command was not delivered. Retrying reuses the same command and will not duplicate the digit.');
    case 'phone_dtmf_reconciliation_required':
    case 'air780_dtmf_operation_conflict':
      return _text(chinese, '上一个拨号按键正在对账，请勿连续输入。',
          'The previous keypad command is being reconciled. Wait before entering another digit.');
    case 'air780_dtmf_rejected':
      return _text(chinese, '设备拒绝了拨号按键，请确认通话仍已接通。',
          'The device rejected the keypad command. Confirm the call is still connected.');
    case 'sip_transfer_unavailable':
      return _text(
          chinese, '当前电话不支持转接。', 'Transfer is unavailable for this call.');
    case 'translation_call_not_connected':
      return _text(chinese, '电话接通后才能使用翻译控制。',
          'Translation controls are available after the carrier call connects.');
    case 'translation_worker_not_ready':
    case 'translation_control_not_configured':
    case 'translation_control_unavailable':
      return _text(chinese, '翻译 Worker 尚未就绪，请稍后重试。',
          'The translation worker is not ready. Try again shortly.');
    case 'translation_uplink_paused':
      return _text(chinese, '译声上行已暂停；恢复后才能发送文字译音。',
          'Translated uplink is paused. Resume it before sending typed speech.');
    case 'translation_control_pending':
      return _text(chinese, '上一个翻译控制正在确认，请勿重复操作。',
          'The previous translation control is being reconciled.');
    case 'invalid_type_to_speak':
      return _text(chinese, '请输入有效且不过长的文字。',
          'Enter valid text within the length limit.');
    case 'translation_uplink_control_failed':
      return _text(chinese, '译声控制未完成；为安全起见当前保持暂停。',
          'The uplink control failed and remains paused for safety.');
    case 'type_to_speak_failed':
      return _text(chinese, '文字译音未送达，请确认译声已恢复后重试。',
          'Typed speech was not delivered. Resume translation and try again.');
    case 'translation_control_operation_conflict':
    case 'translation_control_state_conflict':
    case 'translation_control_generation_conflict':
    case 'translation_control_binding_conflict':
      return _text(chinese, '翻译控制状态已变化，请等待同步后重试。',
          'Translation control state changed. Wait for sync and try again.');
    case 'invalid_call_diagnostic_marker':
    case 'call_diagnostic_marker_conflict':
      return _text(chinese, '通话问题标记未保存，请稍后重试。',
          'The call issue marker was not saved. Try again shortly.');
    case 'call_diagnostic_marker_pending':
      return _text(chinese, '上一个通话问题标记正在确认，请稍后重试。',
          'The previous call issue marker is being reconciled. Try again shortly.');
  }

  if (apiError?.statusCode == 429) {
    return _text(
        chinese, '请求过于频繁，请稍后再试。', 'Too many requests. Try again shortly.');
  }
  if (apiError != null && (apiError.statusCode ?? 0) >= 500) {
    return _text(chinese, '通话服务暂时不可用，请稍后重试。',
        'The calling service is temporarily unavailable. Try again shortly.');
  }
  return _text(chinese, '拨号请求未完成，请检查网络后重试。',
      'The calling request did not complete. Check the network and try again.');
}

String _text(bool chinese, String zh, String en) => chinese ? zh : en;
