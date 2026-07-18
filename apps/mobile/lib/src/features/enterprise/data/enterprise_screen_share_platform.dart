import 'enterprise_meeting_screen_share_models.dart';

typedef EnterpriseScreenSharePublished = void Function(
  String trackSid,
  String captureTrackId,
);

abstract interface class EnterpriseScreenSharePublisher {
  bool get isSupported;

  Future<void> start({
    required EnterpriseMobileScreenShareGrant grant,
    required String qualityMode,
    required EnterpriseScreenSharePublished onPublished,
    required void Function() onEnded,
    required bool Function() isCancelled,
  });

  Future<void> stop({bool requestSystemStop = true});
}

abstract interface class EnterpriseScreenShareBridge {
  Future<bool> isConfigured();

  Future<void> requestAuthorization();

  Future<void> prepare({
    required EnterpriseMobileScreenShare share,
    required String controlNonce,
  });

  Future<void> activate({
    required EnterpriseMobileScreenShare share,
    required String controlNonce,
    required String captureTrackId,
  });

  Future<void> renew({
    required EnterpriseMobileScreenShare share,
    required String controlNonce,
  });

  Future<void> deactivate();

  Future<void> clear({
    required EnterpriseMobileScreenShare share,
    required String controlNonce,
  });

  void setOnSystemStopped(void Function() callback);

  Future<void> dispose();
}

class EnterpriseScreenSharePlatformException implements Exception {
  const EnterpriseScreenSharePlatformException(this.code);

  final String code;

  @override
  String toString() => code;
}
