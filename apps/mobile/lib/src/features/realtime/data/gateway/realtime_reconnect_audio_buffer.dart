import 'dart:collection';

import '../../../../platform/audio/audio_frame.dart';

class RealtimeReconnectAudioDrain {
  const RealtimeReconnectAudioDrain({
    required this.frames,
    required this.replayedAudioMs,
    required this.droppedAudioMs,
  });

  static const empty = RealtimeReconnectAudioDrain(
    frames: <AudioFrame>[],
    replayedAudioMs: 0,
    droppedAudioMs: 0,
  );

  final List<AudioFrame> frames;
  final int replayedAudioMs;
  final int droppedAudioMs;
}

class RealtimeReconnectAudioBuffer {
  RealtimeReconnectAudioBuffer({this.maxDurationMs = 2400});

  final int maxDurationMs;
  final ListQueue<_BufferedAudioFrame> _frames = ListQueue();
  int _bufferedAudioMs = 0;
  int _droppedAudioMs = 0;

  void add(AudioFrame frame) {
    final buffered = _BufferedAudioFrame(
      frame: frame,
      durationMs: _frameDurationMs(frame),
    );
    _frames.add(buffered);
    _bufferedAudioMs += buffered.durationMs;
    while (_bufferedAudioMs > maxDurationMs && _frames.isNotEmpty) {
      final dropped = _frames.removeFirst();
      _bufferedAudioMs -= dropped.durationMs;
      _droppedAudioMs += dropped.durationMs;
    }
  }

  RealtimeReconnectAudioDrain drain() {
    if (_frames.isEmpty && _droppedAudioMs == 0) {
      return RealtimeReconnectAudioDrain.empty;
    }
    final drained = RealtimeReconnectAudioDrain(
      frames: _frames.map((entry) => entry.frame).toList(growable: false),
      replayedAudioMs: _bufferedAudioMs,
      droppedAudioMs: _droppedAudioMs,
    );
    clear();
    return drained;
  }

  void clear() {
    _frames.clear();
    _bufferedAudioMs = 0;
    _droppedAudioMs = 0;
  }

  int _frameDurationMs(AudioFrame frame) {
    if (frame.sampleRate <= 0 || frame.bytes.isEmpty) return 1;
    final duration = (frame.bytes.length / 2 / frame.sampleRate * 1000).round();
    return duration < 1 ? 1 : duration;
  }
}

class _BufferedAudioFrame {
  const _BufferedAudioFrame({
    required this.frame,
    required this.durationMs,
  });

  final AudioFrame frame;
  final int durationMs;
}
