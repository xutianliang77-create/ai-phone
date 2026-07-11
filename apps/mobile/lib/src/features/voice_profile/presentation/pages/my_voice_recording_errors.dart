import 'package:flutter/services.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/voice_profile_api_client.dart';
import '../../data/voice_reference_recorder.dart';

String voiceRecordingErrorMessage(AppLocalizations l10n, Object error) {
  if (_hasVoiceRecorderCode(error, 'microphone_permission_denied')) {
    return l10n.text('myVoiceMicrophonePermissionDenied');
  }
  return _messageWithReason(
    l10n,
    l10n.text('myVoiceRecordingFailed'),
    error,
  );
}

String voiceUploadErrorMessage(AppLocalizations l10n, Object error) {
  if (_hasVoiceRecorderCode(error, 'recording_empty')) {
    return l10n.text('myVoiceRecordingEmpty');
  }
  return _messageWithReason(l10n, l10n.text('myVoiceUploadFailed'), error);
}

String voiceTestErrorMessage(AppLocalizations l10n, Object error) {
  return _messageWithReason(l10n, l10n.text('myVoiceTestFailed'), error);
}

bool _hasVoiceRecorderCode(Object error, String code) {
  return error is VoiceReferenceRecorderException && error.code == code;
}

String _messageWithReason(
  AppLocalizations l10n,
  String prefix,
  Object error,
) {
  final reason = _voiceReferenceErrorReason(l10n, error);
  if (reason.isEmpty) return prefix;
  return '$prefix：$reason';
}

String _voiceReferenceErrorReason(AppLocalizations l10n, Object error) {
  if (error is VoiceProfileApiException) {
    return _trimErrorDetail(_apiErrorMessage(error.body));
  }
  if (error is VoiceReferenceRecorderException) {
    if (error.code == 'wav_encoder_unsupported') {
      return l10n.text('myVoiceWavUnsupported');
    }
    return _trimErrorDetail(error.message ?? error.code);
  }
  if (error is PlatformException) {
    final message = error.message;
    if (message == null || message.isEmpty) return error.code;
    return _trimErrorDetail('${error.code}: $message');
  }
  return _trimErrorDetail(error.toString());
}

String _apiErrorMessage(Map<String, Object?> body) {
  final error = body['error'];
  if (error is Map) {
    final message = error['message'];
    if (message is String && message.isNotEmpty) return message;
    final code = error['code'];
    if (code is String && code.isNotEmpty) return code;
  }
  return 'unknown_api_error';
}

String _trimErrorDetail(String value) {
  const maxLength = 140;
  return value.length <= maxLength
      ? value
      : '${value.substring(0, maxLength)}...';
}
