Future<void> ignoreCleanupError(Future<void> Function() action) async {
  try {
    await action();
  } catch (_) {}
}
