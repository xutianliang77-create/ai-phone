import 'dart:async';
import 'dart:math';

import 'enterprise_ios_screen_share_publisher.dart';
import 'enterprise_meeting_screen_share_api.dart';
import 'enterprise_meeting_screen_share_models.dart';
import 'enterprise_mobile_api_client.dart';
import 'enterprise_mobile_models.dart';
import 'enterprise_replaykit_bridge.dart';

part 'enterprise_meeting_screen_share_lifecycle.dart';

enum EnterpriseMeetingScreenShareOperation {
  idle,
  waitingForBroadcast,
  active,
  paused,
  stopping,
  failed,
}

class EnterpriseMeetingScreenShareSnapshot {
  const EnterpriseMeetingScreenShareSnapshot({
    required this.operation,
    required this.revocation,
    this.share,
    this.errorCode,
  });

  const EnterpriseMeetingScreenShareSnapshot.idle()
      : operation = EnterpriseMeetingScreenShareOperation.idle,
        revocation = 'not_required',
        share = null,
        errorCode = null;

  final EnterpriseMeetingScreenShareOperation operation;
  final EnterpriseMobileScreenShare? share;
  final String revocation;
  final String? errorCode;
}

class EnterpriseMeetingScreenShareController {
  EnterpriseMeetingScreenShareController({
    required this.api,
    required this.workspace,
    required this.meetingId,
    required this.participantId,
    required this.onSnapshot,
    EnterpriseIosScreenSharePublisher? publisher,
    EnterpriseReplayKitBridge? bridge,
  })  : _publisher = publisher ?? EnterpriseIosScreenSharePublisher(),
        _bridge = bridge ?? EnterpriseReplayKitBridge();

  final EnterpriseMobileApiClient api;
  final EnterpriseMobileWorkspace workspace;
  final String meetingId;
  final String participantId;
  final void Function(EnterpriseMeetingScreenShareSnapshot) onSnapshot;
  final EnterpriseIosScreenSharePublisher _publisher;
  final EnterpriseReplayKitBridge _bridge;
  EnterpriseMeetingScreenShareSnapshot _snapshot =
      const EnterpriseMeetingScreenShareSnapshot.idle();
  Timer? _pollTimer;
  Timer? _renewTimer;
  Timer? _activationTimer;
  String? _controlNonce;
  String? _pendingTrackSid;
  bool _busy = false;
  bool _stopRequested = false;
  bool _disposed = false;
  int _epoch = 0;

  bool get isSupported => _publisher.isSupported;

  void startPolling() {
    unawaited(_refresh());
    _pollTimer ??= Timer.periodic(
      const Duration(seconds: 2),
      (_) => unawaited(_refresh()),
    );
  }

  Future<void> start(String qualityMode) async {
    if (_busy || _disposed || _controlNonce != null) return;
    if (!const <String>{'auto', 'smooth', 'high'}.contains(qualityMode)) {
      _emit(
          operation: EnterpriseMeetingScreenShareOperation.failed,
          errorCode: 'invalid_screen_share_quality');
      return;
    }
    if (!isSupported || !await _bridge.isConfigured()) {
      _emit(
          operation: EnterpriseMeetingScreenShareOperation.failed,
          errorCode: 'replaykit_not_configured');
      return;
    }
    _epoch += 1;
    _busy = true;
    _emit(
        operation: EnterpriseMeetingScreenShareOperation.waitingForBroadcast,
        errorCode: null);
    try {
      final version = await api.getMeetingVersion(workspace, meetingId);
      _ensureStarting();
      final response = await api.acquireScreenShare(
        workspace,
        meetingId,
        qualityMode: qualityMode,
        expectedMeetingVersion: version,
        idempotencyKey: _uuid(),
      );
      final share = response.share;
      final grant = response.grant;
      if (share.participantId != participantId || grant == null) {
        throw const EnterpriseReplayKitException('screen_share_grant_mismatch');
      }
      final nonce = _uuid();
      _controlNonce = nonce;
      _emit(share: share, revocation: response.revocation);
      _ensureStarting();
      await _bridge.prepare(share: share, controlNonce: nonce);
      _ensureStarting();
      await _publisher.start(
        grant: grant,
        qualityMode: qualityMode,
        onPublished: _published,
        onEnded: _broadcastEnded,
        isCancelled: () => _disposed || _stopRequested,
      );
      _ensureStarting();
      _startRenewing();
      _activationTimer = Timer(
        const Duration(seconds: 25),
        () => unawaited(_activationExpired()),
      );
    } catch (error) {
      await _failClosed(error);
    } finally {
      _busy = false;
      if (_pendingTrackSid != null) unawaited(_renew());
      await _finishStopRequest();
    }
  }

  Future<void> stop() async {
    if (_disposed) return;
    if (_busy) {
      _stopRequested = true;
      await _stopLocal();
      return;
    }
    final share = _snapshot.share;
    _epoch += 1;
    _busy = true;
    _emit(
        operation: EnterpriseMeetingScreenShareOperation.stopping,
        errorCode: null);
    await _stopLocal();
    if (share == null ||
        share.participantId != participantId ||
        const <String>{'ended', 'expired'}.contains(share.status)) {
      _emit(operation: EnterpriseMeetingScreenShareOperation.idle);
      _busy = false;
      return;
    }
    final key = _uuid();
    try {
      final response = await api.commandScreenShare(
        workspace,
        meetingId,
        share,
        'stop',
        idempotencyKey: key,
      );
      _emit(
        operation: response.revocation == 'pending'
            ? EnterpriseMeetingScreenShareOperation.stopping
            : EnterpriseMeetingScreenShareOperation.idle,
        share: response.share,
        revocation: response.revocation,
      );
      if (response.revocation == 'pending') {
        unawaited(_retryStop(share, key));
      }
    } catch (error) {
      _emit(
          operation: EnterpriseMeetingScreenShareOperation.failed,
          errorCode: _errorCode(error));
    } finally {
      _busy = false;
    }
  }

  Future<void> dispose() async {
    if (_disposed) return;
    final share = _snapshot.share;
    _disposed = true;
    _epoch += 1;
    _pollTimer?.cancel();
    await _stopLocal();
    if (share?.participantId == participantId &&
        const <String>{'active', 'paused'}.contains(share?.status)) {
      try {
        await api.commandScreenShare(
          workspace,
          meetingId,
          share!,
          'stop',
          idempotencyKey: _uuid(),
        );
      } catch (_) {}
    }
  }

  void _published(String trackSid) {
    if (_disposed || _controlNonce == null) return;
    _pendingTrackSid = trackSid;
    _activationTimer?.cancel();
    if (!_busy) unawaited(_renew());
  }

  void _broadcastEnded() {
    _stopRequested = true;
    unawaited(_stopLocal().then((_) => _finishStopRequest()));
  }

  void _ensureStarting() {
    if (_disposed || _stopRequested) {
      throw const EnterpriseReplayKitException('screen_share_start_cancelled');
    }
  }

  Future<void> _renew() async {
    final share = _ownedActiveShare();
    if (_busy || _disposed || share == null || _controlNonce == null) return;
    _epoch += 1;
    _busy = true;
    try {
      final response = await api.commandScreenShare(
        workspace,
        meetingId,
        share,
        'renew',
        idempotencyKey: _uuid(),
        trackSid: _pendingTrackSid ?? share.trackSid,
      );
      if (response.share.participantId != participantId) {
        throw const EnterpriseReplayKitException('screen_share_owner_changed');
      }
      await _bridge.renew(
        share: response.share,
        controlNonce: _controlNonce!,
      );
      _pendingTrackSid = response.share.trackSid ?? _pendingTrackSid;
      _emit(
          operation: _pendingTrackSid == null
              ? EnterpriseMeetingScreenShareOperation.waitingForBroadcast
              : EnterpriseMeetingScreenShareOperation.active,
          share: response.share,
          revocation: response.revocation,
          errorCode: null);
    } catch (error) {
      _emit(errorCode: _errorCode(error));
      _stopRequested = true;
    } finally {
      _busy = false;
      await _finishStopRequest();
    }
  }
}
