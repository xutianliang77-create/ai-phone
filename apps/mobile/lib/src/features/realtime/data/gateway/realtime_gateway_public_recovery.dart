part of 'realtime_gateway_client.dart';

extension PublicPausedRecovery on RealtimeGatewayClient {
  bool canRecoverPausedPublicSession(String sessionId) =>
      _session?.syncBinding != null && _session?.sessionId == sessionId &&
      _publicPaused && !_manualClose && _lastAudioSequence >= 0;
}

class _PublicRecoveryBridge {
  Completer<({int lastAcceptedSample, int nextSequence})>? _ready;
  int? _firstSequence;
  int? _lastAcceptedSample;
  bool _resumed = false;

  int? get firstSequence => _firstSequence;

  Map<String, int>? get resumePayload {
    final sequence = _firstSequence;
    final samples = _lastAcceptedSample;
    if (_resumed || sequence == null || samples == null) return null;
    return {'lastAcceptedSample': samples, 'nextSequence': sequence};
  }

  void prepare(bool expected) {
    reset();
    if (!expected) return;
    _ready = Completer<({int lastAcceptedSample, int nextSequence})>();
    unawaited(_ready!.future.then<void>((_) {}, onError: (Object _) {}));
  }

  Future<void> waitForReady(Duration timeout, {required int samples, required int nextSequence}) async {
    final bridge = await _ready!.future.timeout(timeout);
    if (bridge.lastAcceptedSample != samples || bridge.nextSequence != nextSequence) {
      throw StateError('Public recovery watermark differs from confirmed paused audio');
    }
    _lastAcceptedSample = bridge.lastAcceptedSample;
    _firstSequence = bridge.nextSequence;
  }

  void receive(int? samples, int? sequence) {
    final ready = _ready;
    if (ready == null || ready.isCompleted || samples == null || sequence == null) {
      return;
    }
    ready.complete((lastAcceptedSample: samples, nextSequence: sequence));
  }

  void acceptFirst() => _firstSequence = null;
  void confirmResume() => _resumed = true;

  void fail() {
    final ready = _ready;
    if (ready != null && !ready.isCompleted) {
      ready.completeError(StateError('Public recovery bridge was not confirmed'));
    }
  }

  void reset() {
    _ready = null;
    _firstSequence = null;
    _lastAcceptedSample = null;
    _resumed = false;
  }
}
