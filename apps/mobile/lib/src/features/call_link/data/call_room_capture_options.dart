import 'package:livekit_client/livekit_client.dart' as livekit;

const callRoomAudioCaptureOptions = livekit.AudioCaptureOptions(
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  voiceIsolation: true,
  stopAudioCaptureOnMute: false,
);
