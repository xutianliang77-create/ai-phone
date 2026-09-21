part of 'realtime_controller.dart';

class _LocalPartialTranslationFlush {
  AsrTextSegment? _segment;

  void remember(AsrTextSegment segment) {
    _segment = segment;
  }

  AsrTextSegment? take() {
    final segment = _segment;
    cancel();
    return segment;
  }

  void clearIfSameId(String id) {
    if (_segment?.id == id) cancel();
  }

  void cancel() {
    _segment = null;
  }
}
