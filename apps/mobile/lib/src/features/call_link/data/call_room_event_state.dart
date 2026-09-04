import 'call_room_client.dart';

class CallRoomEventState {
  int? _latestPipelineGeneration;
  final Map<String, int> _latestPlaybackGenerations = <String, int>{};

  bool accept({
    int? pipelineGeneration,
    String? playbackId,
    int? playbackGeneration,
  }) {
    if (!_acceptPipelineGeneration(pipelineGeneration)) return false;
    return _acceptPlaybackGeneration(playbackId, playbackGeneration);
  }

  List<CallRoomCaption> mergeCaption(
    List<CallRoomCaption> current,
    CallRoomCaption caption,
  ) {
    final captions = List<CallRoomCaption>.of(current);
    final index =
        captions.indexWhere((item) => item.segmentId == caption.segmentId);
    if (index == -1) {
      captions.add(caption);
    } else {
      captions[index] = captions[index].merge(caption);
    }
    final start = captions.length > 50 ? captions.length - 50 : 0;
    return List<CallRoomCaption>.unmodifiable(captions.sublist(start));
  }

  void reset() {
    _latestPipelineGeneration = null;
    _latestPlaybackGenerations.clear();
  }

  bool _acceptPipelineGeneration(int? generation) {
    if (generation == null) return true;
    final latest = _latestPipelineGeneration;
    if (latest != null && generation < latest) return false;
    if (latest == null || generation > latest) {
      _latestPipelineGeneration = generation;
    }
    return true;
  }

  bool _acceptPlaybackGeneration(String? playbackId, int? generation) {
    if (playbackId == null || generation == null) return true;
    final latest = _latestPlaybackGenerations[playbackId];
    if (latest != null && generation < latest) return false;
    if (latest == null || generation > latest) {
      _latestPlaybackGenerations[playbackId] = generation;
    }
    return true;
  }
}
