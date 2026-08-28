import 'dart:async';

import 'package:livekit_client/livekit_client.dart' as livekit;

class RemoteAudioEvidenceCounters {
  const RemoteAudioEvidenceCounters({
    required this.packetsReceived,
    required this.bytesReceived,
    required this.totalAudioEnergy,
  });

  final num? packetsReceived;
  final num? bytesReceived;
  final num? totalAudioEnergy;

}

bool hasRemoteAudioPlayoutProgress(
  RemoteAudioEvidenceCounters previous,
  RemoteAudioEvidenceCounters current,
) {
  if (!_increased(previous.packetsReceived, current.packetsReceived) ||
      !_increased(previous.bytesReceived, current.bytesReceived)) {
    return false;
  }
  final previousEnergy = previous.totalAudioEnergy;
  final currentEnergy = current.totalAudioEnergy;
  if (previousEnergy != null && currentEnergy != null) {
    return currentEnergy > previousEnergy;
  }
  return true;
}

Future<bool> waitForLiveKitRemoteAudioPlayoutEvidence({
  required livekit.Room room,
  required String participantIdentity,
  required Duration timeout,
}) async {
  if (timeout <= Duration.zero || participantIdentity.trim().isEmpty) {
    return false;
  }
  final elapsed = Stopwatch()..start();
  final previous = <String, RemoteAudioEvidenceCounters>{};
  while (elapsed.elapsed < timeout) {
    if (room.connectionState == livekit.ConnectionState.connected &&
        room.canPlaybackAudio) {
      final participant = room.remoteParticipants.values
          .where((item) => item.identity == participantIdentity)
          .firstOrNull;
      if (participant != null) {
        for (final publication in participant.audioTrackPublications) {
          final track = publication.track;
          if (!publication.subscribed || publication.muted ||
              track == null || !track.isActive) {
            continue;
          }
          try {
            final stats = await track.getReceiverStats();
            if (stats == null) continue;
            final current = RemoteAudioEvidenceCounters(
              packetsReceived: stats.packetsReceived,
              bytesReceived: stats.bytesReceived,
              totalAudioEnergy: stats.totalAudioEnergy,
            );
            final baseline = previous[publication.sid];
            previous[publication.sid] = current;
            if (baseline != null &&
                hasRemoteAudioPlayoutProgress(baseline, current)) {
              return true;
            }
          } on Object {
            // Stats may be transiently unavailable during subscription setup.
          }
        }
      }
    }
    final remaining = timeout - elapsed.elapsed;
    if (remaining <= Duration.zero) break;
    await Future<void>.delayed(
      remaining < const Duration(milliseconds: 50)
          ? remaining
          : const Duration(milliseconds: 50),
    );
  }
  return false;
}

bool _increased(num? previous, num? current) =>
    previous != null && current != null && current > previous;

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull {
    final iterator = this.iterator;
    return iterator.moveNext() ? iterator.current : null;
  }
}
