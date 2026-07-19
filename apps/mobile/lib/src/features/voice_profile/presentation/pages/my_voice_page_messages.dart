import '../../../../app/localization/app_localizations.dart';
import '../../../account/data/account_auth_headers.dart';
import 'my_voice_constants.dart';

String? voiceReferenceDurationError(
  AppLocalizations l10n,
  int durationMs,
) {
  if (durationMs < voiceReferenceMinDurationMs) {
    return l10n.text('myVoiceRecordTooShort');
  }
  if (durationMs > voiceReferenceMaxDurationMs) {
    return l10n.text('myVoiceRecordTooLong');
  }
  return null;
}

String myVoicePageFriendlyError(AppLocalizations l10n, Object error) {
  if (error is AccountAuthRequiredException) {
    return l10n.myVoiceAuthRequired;
  }
  return l10n.myVoiceLoadFailed;
}
