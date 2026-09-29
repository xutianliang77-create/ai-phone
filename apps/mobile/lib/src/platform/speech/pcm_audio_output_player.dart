import 'package:flutter/services.dart';

class PcmAudioOutputResult {
  const PcmAudioOutputResult({
    required this.provider,
    required this.sampleRate,
    this.sharedPlaybackReference = false,
  });

  final String provider;
  final int sampleRate;
  final bool sharedPlaybackReference;
}

abstract class PcmAudioOutputPlayer {
  Future<PcmAudioOutputResult> play({
    required String data,
    required int sampleRate,
  });

  Future<void> stop();
}

class SystemPcmAudioOutputPlayer implements PcmAudioOutputPlayer {
  SystemPcmAudioOutputPlayer({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel(_channelName);

  static const _channelName = 'translation_mobile/audio_output';

  final MethodChannel _channel;

  @override
  Future<PcmAudioOutputResult> play({
    required String data,
    required int sampleRate,
  }) async {
    final result = await _channel.invokeMapMethod<String, Object?>(
      'playPcm',
      <String, Object?>{
        'format': 'pcm16',
        'sampleRate': sampleRate,
        'data': data,
      },
    );
    return PcmAudioOutputResult(
      provider: result?['provider'] as String? ?? 'server_pcm_tts',
      sampleRate: (result?['sampleRate'] as num?)?.toInt() ?? sampleRate,
      sharedPlaybackReference: result?['sharedPlaybackReference'] == true,
    );
  }

  @override
  Future<void> stop() async {
    await _channel.invokeMethod<void>('stop');
  }
}
