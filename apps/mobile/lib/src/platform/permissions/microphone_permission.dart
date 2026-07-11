enum MicrophonePermissionStatus {
  granted,
  denied,
  permanentlyDenied,
}

abstract interface class MicrophonePermission {
  Future<MicrophonePermissionStatus> request();
  Future<MicrophonePermissionStatus> status();
  Future<void> openSettings();
}
