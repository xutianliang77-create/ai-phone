import 'dart:async';

import '../../../../platform/diagnostics/app_error_reporter.dart';

void reportVoiceReferenceError(
  AppErrorReporter reporter,
  Object error,
  StackTrace stackTrace, {
  required String stage,
  required String? profileStatus,
  required bool recording,
}) {
  unawaited(reporter.reportError(
    error,
    stackTrace,
    eventType: 'voice_reference_recording_error',
    fatal: false,
    context: <String, Object?>{
      'stage': stage,
      'profileStatus': profileStatus,
      'recording': recording,
    },
  ));
}
