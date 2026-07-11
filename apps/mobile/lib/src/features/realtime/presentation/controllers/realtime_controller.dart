import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../../../app/app_config.dart';
import '../../../../platform/audio/audio_capture.dart';
import '../../../../platform/audio/audio_frame.dart';
import '../../../../platform/audio/audio_session_coordinator.dart';
import '../../../../platform/asr/asr_text_segment.dart';
import '../../../../platform/asr/mobile_asr_provider.dart';
import '../../../../platform/speech/pcm_audio_output_player.dart';
import '../../../../platform/speech/speech_output_provider.dart';
import '../../../../platform/speech/speech_text_normalizer.dart';
import '../../../../platform/translation/mobile_translation_provider.dart';
import '../../../../platform/translation/supported_translation_language.dart';
import '../../data/api/realtime_session.dart';
import '../../data/gateway/gateway_realtime_event.dart';
import '../../data/realtime_repository.dart';
import '../../../realtime/domain/entities/subtitle_segment.dart';
import 'cleanup_guard.dart';
import 'device_asr_failure_message.dart';
import 'error_display_message.dart';
import 'realtime_gateway_diagnostic.dart';
import 'realtime_runtime_factories.dart';
import 'realtime_session_state.dart';
import 'segment_draft.dart';
import 'speech_capture_gate.dart';

export 'realtime_session_state.dart';

part 'realtime_controller_gateway_events.dart';
part 'realtime_controller_audio_session.dart';
part 'realtime_controller_device_asr_recovery.dart';
part 'realtime_controller_local_translation.dart';
part 'realtime_controller_lifecycle.dart';
part 'realtime_controller_segments.dart';
part 'realtime_controller_speech.dart';
part 'realtime_controller_start.dart';
part 'realtime_controller_stop.dart';

class RealtimeController extends ChangeNotifier {
  static const Duration _deviceAsrStopDrain = Duration(milliseconds: 120);
  RealtimeController({
    RealtimeRepository? repository,
    AudioCapture? audioCapture,
    MobileAsrProvider? mobileAsrProvider,
    MobileTranslationProvider? mobileTranslationProvider,
    SpeechOutputProvider? speechOutputProvider,
    PcmAudioOutputPlayer? pcmAudioOutputPlayer,
    AudioSessionCoordinator? audioSessionCoordinator,
    SpeechCaptureGate? speechCaptureGate,
    bool autoSpeakTranslation = false,
    Duration? speechOutputTimeout,
    AppConfig? config,
  })  : _config = config ?? AppConfig.fromEnvironment(),
        _repository = repository ??
            createDefaultRealtimeRepository(
              config ?? AppConfig.fromEnvironment(),
            ),
        _audioCapture = audioCapture ??
            createDefaultAudioCapture(
              config ?? AppConfig.fromEnvironment(),
            ),
        _mobileAsrProvider = mobileAsrProvider ??
            createDefaultMobileAsrProvider(
                config ?? AppConfig.fromEnvironment()),
        _mobileTranslationProvider = mobileTranslationProvider ??
            createDefaultMobileTranslationProvider(
                config ?? AppConfig.fromEnvironment()),
        _speechOutputProvider = speechOutputProvider,
        _pcmAudioOutputPlayer = pcmAudioOutputPlayer,
        _audioSessionCoordinator =
            audioSessionCoordinator ?? const NoopAudioSessionCoordinator(),
        _speechCaptureGate = speechCaptureGate ?? SpeechCaptureGate(),
        _autoSpeakTranslation = autoSpeakTranslation,
        _speechOutputTimeout = speechOutputTimeout;

  final AppConfig _config;
  final RealtimeRepository _repository;
  final AudioCapture _audioCapture;
  final MobileAsrProvider? _mobileAsrProvider;
  final MobileTranslationProvider? _mobileTranslationProvider;
  final SpeechOutputProvider? _speechOutputProvider;
  final PcmAudioOutputPlayer? _pcmAudioOutputPlayer;
  final AudioSessionCoordinator _audioSessionCoordinator;
  bool _autoSpeakTranslation;
  final Duration? _speechOutputTimeout;
  Future<void> _speechChain = Future<void>.value();
  int _speechGeneration = 0;
  final SpeechCaptureGate _speechCaptureGate;
  RealtimeStatus _status = RealtimeStatus.idle;
  final List<SubtitleSegment> _segments = <SubtitleSegment>[];
  final Map<String, SegmentDraft> _drafts = <String, SegmentDraft>{};
  StreamSubscription<GatewayRealtimeEvent>? _eventSubscription;
  StreamSubscription<dynamic>? _audioSubscription;
  StreamSubscription<AsrTextSegment>? _asrSubscription;
  StreamSubscription<AudioSessionEvent>? _audioSessionSubscription;
  RealtimeSession? _session;
  Timer? _sessionTimeoutTimer;
  String? _message;
  int? _remainingSeconds;
  bool _lowBalance = false;
  RealtimeGatewayDiagnostic? _gatewayDiagnostic;
  RealtimeStatus? _statusBeforeReconnect;
  bool _resumeAfterLifecyclePause = false, _stopInFlight = false;
  bool _disposed = false;
  bool _audioSessionRecoveryInFlight = false;
  int _startGeneration = 0;
  Future<void>? _startCompletion;
  Future<void>? _failureCleanup;
  final _localPartialFlush = _LocalPartialTranslationFlush();
  final _deviceAsrRecovery = _DeviceAsrRecovery();

  RealtimeStatus get status => _status;
  List<SubtitleSegment> get segments => List.unmodifiable(_segments);
  String? get message => _message;
  int? get remainingSeconds => _remainingSeconds;
  bool get lowBalance => _lowBalance;
  RealtimeGatewayDiagnostic? get gatewayDiagnostic => _gatewayDiagnostic;

  void setAutoSpeakTranslation(bool enabled) {
    if (_autoSpeakTranslation == enabled) return;
    _autoSpeakTranslation = enabled;
    if (!enabled) unawaited(_stopSpeaking());
    _notify();
  }

  Future<void> pause() async {
    final session = _session;
    if (session == null || _status != RealtimeStatus.active) return;
    try {
      if (_usesDeviceAsr) {
        await _mobileAsrProvider?.stop();
        await _drainDeviceAsrStopEvents();
      } else {
        await _audioCapture.pause();
      }
      await _audioSessionCoordinator.endCapture();
      await _stopSpeaking();
      if (!await _repository.pauseAndWait(session.sessionId)) {
        throw StateError('Realtime connection lost');
      }
      _setStatus(RealtimeStatus.paused);
    } catch (error) {
      _fail(await _failureMessage(error));
    }
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _sessionTimeoutTimer?.cancel();
    _localPartialFlush.cancel();
    _deviceAsrRecovery.reset();
    unawaited(disposeAsync());
    super.dispose();
  }

  Future<void> _resume() async {
    final session = _session;
    if (session == null) return;
    if (!await _repository.resumeAndWait(session.sessionId)) {
      throw StateError('Realtime connection lost');
    }
    if (_usesDeviceAsr) {
      await _startMobileAsrProvider();
    } else {
      await _resumeManagedAudioCapture();
    }
    _setStatus(RealtimeStatus.active);
  }

  Future<void> _resumeOrFail() async {
    try {
      await _resume();
    } catch (error) {
      _fail(await _failureMessage(error));
    }
  }

  Future<String> _failureMessage(Object error) {
    if (!_usesDeviceAsr) {
      return Future<String>.value(displayRealtimeErrorMessage(error));
    }
    return deviceAsrFailureMessage(_mobileAsrProvider, error);
  }

  Future<void> _startAudioCapture() async {
    await _audioCapture.requestPermission();
    await _audioSubscription?.cancel();
    _audioSubscription = _audioCapture.frames.listen(_sendAudioFrame);
    await _audioCapture.start(const AudioCaptureConfig());
    await _audioSessionCoordinator.beginCapture();
  }

  Future<void> _prepareDeviceAsr() async {
    final provider = _mobileAsrProvider;
    if (provider == null) {
      throw UnsupportedError('Device ASR provider is not configured');
    }
    final diagnostics = provider is MobileAsrDiagnostics
        ? provider as MobileAsrDiagnostics
        : null;
    if (diagnostics == null) return;
    final availability = await diagnostics.availability(
      createDeviceAsrConfig(_config),
    );
    if (!availability.canStart) {
      throw UnsupportedError(availability.message);
    }
    final preparation = provider is MobileAsrPreparation
        ? provider as MobileAsrPreparation
        : null;
    if (preparation == null) return;
    _message = availability.reason == 'ready'
        ? 'Preparing device ASR model'
        : availability.message;
    _notify();
    await preparation.prepare(createDeviceAsrConfig(_config));
    _message = _config.useLocalSessions
        ? 'Device ASR model ready. Starting local session'
        : 'Device ASR model ready. Connecting realtime session';
    _notify();
  }

  void _sendAudioFrame(AudioFrame frame) {
    final session = _session;
    if (session == null || _status != RealtimeStatus.active) return;
    if (_speechCaptureGate.blocksCapture) return;
    _repository.sendAudio(session.sessionId, frame);
  }

  bool _setStatus(RealtimeStatus status) {
    final transition = transitionRealtimeStatus(_status, status);
    if (!transition.accepted) return false;
    if (!transition.changed) return true;
    _status = transition.current;
    if (!isTerminalRealtimeStatus(status)) _message = null;
    _notify();
    return true;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _replaceSegmentsFromDrafts() {
    _segments
      ..clear()
      ..addAll(_drafts.values.map((draft) => draft.toSegment()));
    _notify();
  }

  void _fail(String message) {
    final failedSession = _session;
    _message = message;
    _setStatus(RealtimeStatus.failed);
    _session = null;
    _resumeAfterLifecyclePause = false;
    _statusBeforeReconnect = null;
    _localPartialFlush.cancel();
    _deviceAsrRecovery.reset();
    unawaited(_stopSpeaking());
    _failureCleanup = _cleanupAfterFailure(failedSession);
    unawaited(_failureCleanup);
    _notify();
  }

  Future<void> _cleanupAfterFailure(RealtimeSession? failedSession) async {
    _sessionTimeoutTimer?.cancel();
    await ignoreCleanupError(_audioCapture.stop);
    await ignoreCleanupError(_audioSessionCoordinator.endCapture);
    await ignoreCleanupError(() async => _audioSubscription?.cancel());
    await ignoreCleanupError(() async => _mobileAsrProvider?.stop());
    await ignoreCleanupError(_stopSpeaking);
    await ignoreCleanupError(() async => _asrSubscription?.cancel());
    _audioSubscription = null;
    _asrSubscription = null;
    if (failedSession != null) {
      await ignoreCleanupError(() {
        return _repository.end(failedSession.sessionId, _segments);
      });
    }
    await ignoreCleanupError(_repository.closeRealtime);
  }

  void _startSessionTimeout(RealtimeSession session) {
    _sessionTimeoutTimer?.cancel();
    _sessionTimeoutTimer = Timer(
      Duration(seconds: session.maxDurationSeconds),
      () async {
        _message = 'Session time limit reached';
        await stop();
      },
    );
  }

  bool get _usesDeviceAsr => _config.useDeviceAsr;
}
