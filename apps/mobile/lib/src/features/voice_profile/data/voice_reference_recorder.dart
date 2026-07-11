import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

abstract class VoiceReferenceRecorder {
  Future<void> start();
  Future<VoiceReferenceRecording> stop();
  Future<void> dispose();
}

class VoiceReferenceRecording {
  const VoiceReferenceRecording({
    required this.bytes,
    required this.durationMs,
    this.mimeType = 'audio/wav',
  });

  final List<int> bytes;
  final int durationMs;
  final String mimeType;
}

class RecordVoiceReferenceRecorder implements VoiceReferenceRecorder {
  AudioRecorder? _recorder;
  DateTime? _startedAt;
  String? _path;

  @override
  Future<void> start() async {
    await stopIfNeeded();
    final recorder = _activeRecorder;
    if (!await recorder.hasPermission()) {
      throw const VoiceReferenceRecorderException(
          'microphone_permission_denied');
    }
    if (!await recorder.isEncoderSupported(AudioEncoder.wav)) {
      throw const VoiceReferenceRecorderException('wav_encoder_unsupported');
    }
    final directory = await getTemporaryDirectory();
    final path =
        '${directory.path}/voice-reference-${DateTime.now().millisecondsSinceEpoch}.wav';
    _path = path;
    _startedAt = DateTime.now();
    try {
      await recorder.start(
        const RecordConfig(
          encoder: AudioEncoder.wav,
          sampleRate: 24000,
          numChannels: 1,
          autoGain: false,
          echoCancel: false,
          noiseSuppress: false,
        ),
        path: path,
      );
    } on Object catch (error) {
      _startedAt = null;
      _path = null;
      throw VoiceReferenceRecorderException(
        'record_start_failed',
        error.toString(),
      );
    }
  }

  @override
  Future<VoiceReferenceRecording> stop() async {
    final startedAt = _startedAt;
    final recorder = _recorder;
    if (startedAt == null || recorder == null) {
      throw const VoiceReferenceRecorderException('recording_not_started');
    }
    final outputPath = await recorder.stop();
    _startedAt = null;
    final path = outputPath ?? _path;
    _path = null;
    if (path == null) {
      throw const VoiceReferenceRecorderException('recording_not_started');
    }
    final file = File(path);
    final bytes = await file.readAsBytes();
    await _deleteTemporaryFile(file);
    if (bytes.isEmpty) {
      throw const VoiceReferenceRecorderException('recording_empty');
    }
    final durationMs = DateTime.now().difference(startedAt).inMilliseconds;
    return VoiceReferenceRecording(
      bytes: bytes.toList(growable: false),
      durationMs: durationMs,
    );
  }

  @override
  Future<void> dispose() async {
    await stopIfNeeded();
    await _recorder?.dispose();
    _recorder = null;
  }

  Future<void> stopIfNeeded() async {
    final recorder = _recorder;
    if (recorder != null && await recorder.isRecording()) {
      await recorder.stop();
    }
    _startedAt = null;
    _path = null;
  }

  AudioRecorder get _activeRecorder {
    return _recorder ??= AudioRecorder();
  }

  Future<void> _deleteTemporaryFile(File file) async {
    try {
      if (await file.exists()) await file.delete();
    } on Object {
      // Best-effort cleanup for temporary voice reference files.
    }
  }
}

class VoiceReferenceRecorderException implements Exception {
  const VoiceReferenceRecorderException(this.code, [this.message]);

  final String code;
  final String? message;

  @override
  String toString() => message == null ? code : '$code: $message';
}
