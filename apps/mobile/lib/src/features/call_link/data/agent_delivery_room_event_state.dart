import 'agent_delivery_room_event.dart';

class AgentDeliveryRoomEventState {
  final Map<String, int> _playbackGenerations = <String, int>{};
  final Map<String, int> _stages = <String, int>{};
  final Set<String> _eventIds = <String>{};

  bool accept(AgentDeliveryRoomEvent event) {
    if (_eventIds.contains(event.eventId)) return false;
    final stage = _stage(event.type);
    final generation = _playbackGenerations[event.legId] ?? 0;
    if (event.playbackGeneration < generation) return false;
    if (event.playbackGeneration > generation && stage != 1) return false;
    if (event.playbackGeneration > generation) {
      _playbackGenerations[event.legId] = event.playbackGeneration;
    }
    final key = '${event.deliveryAttemptId}:${event.playbackGeneration}';
    final previous = _stages[key] ?? 0;
    if (!_canTransition(event.type, previous)) return false;
    _stages[key] = stage;
    _eventIds.add(event.eventId);
    while (_stages.length > 128) {
      _stages.remove(_stages.keys.first);
    }
    while (_eventIds.length > 128) {
      _eventIds.remove(_eventIds.first);
    }
    return true;
  }

  void reset() {
    _playbackGenerations.clear();
    _stages.clear();
    _eventIds.clear();
  }

  int _stage(String type) {
    if (type == 'agent.delivery.queued') return 1;
    if (type == 'agent.delivery.started') return 2;
    return 3;
  }

  bool _canTransition(String type, int previous) {
    if (type == 'agent.delivery.queued') return previous == 0;
    if (type == 'agent.delivery.started') return previous == 1;
    if (type == 'agent.delivery.ended') return previous == 2;
    return previous == 1 || previous == 2;
  }
}
