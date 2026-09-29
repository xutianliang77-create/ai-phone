import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform;
import 'package:record/record.dart';

import 'audio_capture.dart';
import 'audio_frame.dart';
import 'online_audio_endpoint.dart';
import 'ios_public_pcm_capture.dart';

class RecordAudioCapture implements AudioCapture {
  RecordAudioCapture({AudioEndpointDetector? endpointDetector})
      : _endpointDetector = endpointDetector ??
            platformAudioEndpointDetector(defaultTargetPlatform);
  final AudioEndpointDetector _endpointDetector;
  OnlineAudioEndpointProcessor? _endpoint;
  int _generation = 0;
  final StreamController<AudioFrame> _frames =
      StreamController<AudioFrame>.broadcast();
  AudioRecorder? _recorder;
  IosPublicPcmCapture? _publicIosCapture;
  StreamSubscription<Uint8List>? _subscription;
  int _sequence = 1;
  AudioCaptureConfig _config = const AudioCaptureConfig();

  @override
  Stream<AudioFrame> get frames => _frames.stream;

  @override
  Future<void> requestPermission() async {
    final hasPermission = await _activeRecorder.hasPermission();
    if (!hasPermission) {
      throw const AudioCaptureException('Microphone permission was denied');
    }
  }

  @override
  Future<void> start(AudioCaptureConfig config) async {
    await stop();
    final generation = ++_generation;
    _config = config;
    if (config.publicEndpointing) {
      final endpoint = OnlineAudioEndpointProcessor(
          _endpointDetector, _frames.add, _frames.addError);
      _endpoint = endpoint;
      await endpoint.start(config.sampleRate, options: config.endpointOptions);
      if (generation != _generation) {
        throw const AudioCaptureException('音频启动已取消');
      }
    }
    if (usesIosPublicPlaybackCapture(config, defaultTargetPlatform)) {
      final input = IosPublicPcmCapture();
      _publicIosCapture = input;
      await input.start(config, (bytes) {
        if (generation == _generation) _emitFrame(bytes);
      }, _frames.addError);
      if (generation != _generation) {
        await input.stop();
        throw const AudioCaptureException('音频启动已取消');
      }
      return;
    }
    final recorder = _activeRecorder;
    await recorder.ios?.manageAudioSession(config.managePlatformAudioSession);
    if (generation != _generation) throw const AudioCaptureException('音频启动已取消');
    final stream = await recorder.startStream(
      RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: config.sampleRate,
        numChannels: 1,
        echoCancel: config.echoCancel,
        noiseSuppress: config.noiseSuppress,
        streamBufferSize: _byteLength(config),
      ),
    );
    if (generation != _generation) {
      await recorder.stop();
      throw const AudioCaptureException('音频启动已取消');
    }
    _subscription = stream.listen(
      (bytes) {
        if (generation == _generation) _emitFrame(bytes);
      },
      onError: _frames.addError,
    );
  }

  @override
  Future<void> pause() async {
    if (_publicIosCapture case final input?) { await input.pause(); return; }
    await _recorder?.pause();
  }

  @override
  Future<void> resume() async {
    if (_publicIosCapture case final input?) { await input.resume(); return; }
    await _recorder?.resume();
  }

  @override
  Future<void> stop() async {
    // Drain the native tail through the unchanged VAD/sequence pipeline before
    // invalidating this capture generation. The native fence excludes late PCM.
    final publicInput = _publicIosCapture;
    Object? stopError;
    StackTrace? stopStack;
    if (publicInput != null) {
      try { await publicInput.stop(); }
      catch (error, stack) { stopError = error; stopStack = stack; }
      finally { if (identical(_publicIosCapture, publicInput)) _publicIosCapture = null; }
    }
    _generation++;
    final subscription = _subscription;
    _subscription = null;
    final recorder = _recorder;
    final endpoint = _endpoint;
    try {
      await subscription?.cancel();
      if (recorder != null && await recorder.isRecording()) {
        await recorder.stop();
      }
    } finally {
      if (identical(_endpoint, endpoint)) _endpoint = null;
      if (endpoint != null) {
        await endpoint.stop();
        await Future<void>.delayed(Duration.zero);
      }
    }
    if (stopError != null) Error.throwWithStackTrace(stopError, stopStack!);
  }

  @override
  Future<void> dispose() async {
    await stop();
    await _recorder?.dispose();
    _recorder = null;
    await _frames.close();
  }

  AudioRecorder get _activeRecorder {
    return _recorder ??= AudioRecorder();
  }

  void _emitFrame(Uint8List bytes) {
    if (bytes.isEmpty) return;
    final frame = AudioFrame(
      sequence: _sequence++,
      timestampMs: DateTime.now().millisecondsSinceEpoch,
      sampleRate: _config.sampleRate,
      bytes: bytes.toList(growable: false),
    );
    final endpoint = _endpoint;
    if (endpoint != null) {
      endpoint.add(frame);
    } else {
      _frames.add(frame);
    }
  }

  int _byteLength(AudioCaptureConfig config) {
    return config.sampleRate * config.frameDurationMs ~/ 500;
  }
}

AudioEndpointDetector platformAudioEndpointDetector(TargetPlatform platform) =>
    platform == TargetPlatform.android
        ? AndroidAudioEndpointDetector()
        : IosAudioEndpointDetector();

class AudioCaptureException implements Exception {
  const AudioCaptureException(this.message);

  final String message;

  @override
  String toString() => message;
}
