String displayRealtimeErrorMessage(Object error) {
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
