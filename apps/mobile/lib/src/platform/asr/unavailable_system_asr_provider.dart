import 'dart:async';

import 'asr_text_segment.dart';
import 'mobile_asr_provider.dart';

class UnavailableSystemAsrProvider implements MobileAsrProvider {
  final StreamController<AsrTextSegment> _segments =
      StreamController<AsrTextSegment>.broadcast();

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  @override
  Future<void> requestPermission() async {
    throw UnsupportedError('System ASR is not implemented for this platform');
  }

  @override
  Future<void> start(MobileAsrConfig config) async {
    throw UnsupportedError('System ASR is not implemented for this platform');
  }

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() async {
    await _segments.close();
  }
}
