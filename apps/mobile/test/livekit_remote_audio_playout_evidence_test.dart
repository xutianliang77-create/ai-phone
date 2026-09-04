import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/call_link/data/livekit_remote_audio_playout_evidence.dart';

void main() {
  test('requires packet, byte, and audio-energy progress when available', () {
    const baseline = RemoteAudioEvidenceCounters(
      packetsReceived: 10,
      bytesReceived: 6400,
      totalAudioEnergy: 1.25,
    );

    expect(
      hasRemoteAudioPlayoutProgress(
        baseline,
        const RemoteAudioEvidenceCounters(
          packetsReceived: 11,
          bytesReceived: 7040,
          totalAudioEnergy: 1.5,
        ),
      ),
      isTrue,
    );
    expect(
      hasRemoteAudioPlayoutProgress(
        baseline,
        const RemoteAudioEvidenceCounters(
          packetsReceived: 11,
          bytesReceived: 7040,
          totalAudioEnergy: 1.25,
        ),
      ),
      isFalse,
    );
  });

  test('falls back to RTP progress when energy stats are unavailable', () {
    expect(
      hasRemoteAudioPlayoutProgress(
        const RemoteAudioEvidenceCounters(
          packetsReceived: 10,
          bytesReceived: 6400,
          totalAudioEnergy: null,
        ),
        const RemoteAudioEvidenceCounters(
          packetsReceived: 11,
          bytesReceived: 7040,
          totalAudioEnergy: null,
        ),
      ),
      isTrue,
    );
  });

  test('rejects bytes without packet progress', () {
    expect(
      hasRemoteAudioPlayoutProgress(
        const RemoteAudioEvidenceCounters(
          packetsReceived: 10,
          bytesReceived: 6400,
          totalAudioEnergy: null,
        ),
        const RemoteAudioEvidenceCounters(
          packetsReceived: 10,
          bytesReceived: 7040,
          totalAudioEnergy: null,
        ),
      ),
      isFalse,
    );
  });
}
