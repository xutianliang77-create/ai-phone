import 'dart:async';

String displayRealtimeErrorMessage(Object error) {
  if (error is TimeoutException) return 'Realtime request timed out';
  final message = error.toString();
  const prefixes = <String>[
    'Unsupported operation: ',
    'Exception: ',
  ];
  for (final prefix in prefixes) {
    if (message.startsWith(prefix)) {
      return message.substring(prefix.length);
    }
  }
  return message;
}

String displayRealtimeFinalizationWarning(Object error) {
  if (error is TimeoutException ||
      error.toString().contains('ClientException') ||
      error.toString().contains('SocketException')) {
    return 'Session ended locally; history sync was not confirmed';
  }
  return displayRealtimeErrorMessage(error);
}
