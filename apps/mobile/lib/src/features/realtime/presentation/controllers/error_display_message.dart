import 'dart:async';

String displayRealtimeErrorMessage(Object error) {
  if (error is TimeoutException) return 'Realtime request timed out';
  final message = error.toString();
  if (message.contains('TimeoutException') ||
      message.contains('Future not completed')) {
    return 'Realtime request timed out';
  }
  if (message.contains('SocketException') ||
      message.contains('ClientException')) {
    return 'Realtime connection lost';
  }
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
  final message = displayRealtimeErrorMessage(error);
  if (message == 'Realtime request timed out' ||
      message == 'Realtime connection lost') {
    return 'Session ended locally; history sync was not confirmed';
  }
  return message;
}
