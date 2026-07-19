enum RealtimeStatus {
  idle,
  connecting,
  active,
  paused,
  ending,
  ended,
  failed,
}

class RealtimeStateTransition {
  const RealtimeStateTransition({
    required this.accepted,
    required this.changed,
    required this.previous,
    required this.current,
  });

  final bool accepted;
  final bool changed;
  final RealtimeStatus previous;
  final RealtimeStatus current;
}

RealtimeStateTransition transitionRealtimeStatus(
  RealtimeStatus previous,
  RealtimeStatus requested,
) {
  if (previous == requested) {
    return RealtimeStateTransition(
      accepted: true,
      changed: false,
      previous: previous,
      current: previous,
    );
  }
  if (!_allowedTargets(previous).contains(requested)) {
    return RealtimeStateTransition(
      accepted: false,
      changed: false,
      previous: previous,
      current: previous,
    );
  }
  return RealtimeStateTransition(
    accepted: true,
    changed: true,
    previous: previous,
    current: requested,
  );
}

bool isTerminalRealtimeStatus(RealtimeStatus status) =>
    status == RealtimeStatus.ended || status == RealtimeStatus.failed;

Set<RealtimeStatus> _allowedTargets(RealtimeStatus status) {
  switch (status) {
    case RealtimeStatus.idle:
      return const {RealtimeStatus.connecting};
    case RealtimeStatus.connecting:
      return const {
        RealtimeStatus.active,
        RealtimeStatus.paused,
        RealtimeStatus.ending,
        RealtimeStatus.ended,
        RealtimeStatus.failed,
      };
    case RealtimeStatus.active:
      return const {
        RealtimeStatus.connecting,
        RealtimeStatus.paused,
        RealtimeStatus.ending,
        RealtimeStatus.ended,
        RealtimeStatus.failed,
      };
    case RealtimeStatus.paused:
      return const {
        RealtimeStatus.connecting,
        RealtimeStatus.active,
        RealtimeStatus.ending,
        RealtimeStatus.ended,
        RealtimeStatus.failed,
      };
    case RealtimeStatus.ending:
      return const {RealtimeStatus.ended, RealtimeStatus.failed};
    case RealtimeStatus.ended:
    case RealtimeStatus.failed:
      return const {RealtimeStatus.idle, RealtimeStatus.connecting};
  }
}
