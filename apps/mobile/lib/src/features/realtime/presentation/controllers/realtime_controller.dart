import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter/services.dart';

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
import '../../../../platform/translation/translation_language_pair.dart';
import '../../../../platform/translation/supported_translation_language.dart';
import '../../../../shared/domain/speaker_attribution.dart';
import '../../../../shared/domain/segment_timeline_order.dart';
import '../../../../shared/domain/turn_language_profile.dart';
import '../../data/api/realtime_session.dart';
import '../../data/gateway/gateway_realtime_event.dart';
import '../../data/realtime_repository.dart';
import '../../data/api/public_creation_resolution.dart';
import '../../../realtime/domain/entities/subtitle_segment.dart';
import 'cleanup_guard.dart';
import 'device_asr_failure_message.dart';
import 'error_display_message.dart';
import 'realtime_active_time_clock.dart';
import 'realtime_gateway_diagnostic.dart';
import 'realtime_local_resource.dart';
import 'realtime_runtime_factories.dart';
import 'realtime_session_state.dart';
import 'segment_draft.dart';
import 'speech_capture_gate.dart';
import 'translation_text_protection.dart';
import 'asr_local_rules.dart';

export 'realtime_session_state.dart';

part 'realtime_controller_audio_input.dart';
part 'realtime_controller_gateway_events.dart';
part 'realtime_controller_audio_session.dart';
part 'realtime_controller_device_asr_recovery.dart';
part 'realtime_controller_local_translation.dart';
part 'realtime_controller_translation_preflight.dart';
part 'realtime_controller_resources.dart';
part 'realtime_controller_voice_resources.dart';
part 'realtime_controller_lifecycle.dart';
part 'realtime_controller_segments.dart';
part 'realtime_controller_speech.dart';
part 'realtime_controller_start.dart';
part 'realtime_controller_stop.dart';
part 'realtime_controller_checkpoints.dart';
part 'realtime_controller_result_sync.dart';
part 'realtime_controller_public_lifecycle.dart';

class RealtimeController extends ChangeNotifier {
  bool _publicCreationResolving = false;
  int _publicCreationResolutionEpoch = 0;
  bool _drainingPublicAudio = false;
  int _endpointEpoch = 0, _pendingEndpoints = 0;
  int _endpointStartGeneration = -1, _publicTurnSamples = 0;
  bool _publicEndpointRequested = false;
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

  AppConfig _config;
  final RealtimeRepository _repository;
  final AudioCapture _audioCapture;
  final MobileAsrProvider? _mobileAsrProvider;
  final MobileTranslationProvider? _mobileTranslationProvider;
  final SpeechOutputProvider? _speechOutputProvider;
  final PcmAudioOutputPlayer? _pcmAudioOutputPlayer;
  final AudioSessionCoordinator _audioSessionCoordinator;
  bool _autoSpeakTranslation;
  bool _voiceOutputUpdating = false;
  final Duration? _speechOutputTimeout;
  Future<void> _speechChain = Future<void>.value();
  Future<void> _asrTextChain = Future<void>.value();
  int _speechGeneration = 0;
  final Map<int, Map<String, double>> _speechQueuedSegments =
      <int, Map<String, double>>{};
  String? _activeSpeechSegmentId;
  int? _activeSpeechGeneration;
  bool _speechOutputActive = false;
  final SpeechCaptureGate _speechCaptureGate;
  final Set<String> _speechEchoSegmentIds = <String>{};
  RealtimeStatus _status = RealtimeStatus.idle;
  final List<SubtitleSegment> _segments = <SubtitleSegment>[];
  final _asrDraftIds = <String>{};
  List<SubtitleSegment> get _finalizationSegments => _config.useLocalSessions
      ? _segments.where((s) => !_asrDraftIds.contains(s.id)).toList()
      : _segments;
  final Map<String, SegmentDraft> _drafts = <String, SegmentDraft>{};
  StreamSubscription<GatewayRealtimeEvent>? _eventSubscription;
  StreamSubscription<dynamic>? _audioSubscription;
  StreamSubscription<AsrTextSegment>? _asrSubscription;
  StreamSubscription<AudioSessionEvent>? _audioSessionSubscription;
  RealtimeSession? _session;
  Timer? _sessionTimeoutTimer;
  String? _message;
  String? _checkpointWarning;
  Future<void>? _checkpointFuture;
  bool _localTailClosed = false;
  final _resultSyncView = _ResultSyncView();
  int? _remainingSeconds;
  bool _lowBalance = false;
  RealtimeGatewayDiagnostic? _gatewayDiagnostic;
  RealtimeStatus? _statusBeforeReconnect;
  bool _resumeAfterLifecyclePause = false, _stopInFlight = false;
  bool _disposed = false;
  bool _audioSessionRecoveryInFlight = false;
  bool _captureInvalidated = false;
  int _startGeneration = 0;
  Future<void>? _failureCleanup;
  Future<void>? _stopFuture, _disposeFuture;
  final _localPartialFlush = _LocalPartialTranslationFlush();
  final _deviceAsrRecovery = _DeviceAsrRecovery();
  final _activeTimeClock = RealtimeActiveTimeClock();
  final _localResources = _LocalResourceState();

  RealtimeStatus get status => _status;
  List<SubtitleSegment> get segments => List.unmodifiable(_segments);
  String? get message => _message ?? _checkpointWarning;
  int? get remainingSeconds => _remainingSeconds;
  bool get lowBalance => _lowBalance;
  RealtimeGatewayDiagnostic? get gatewayDiagnostic => _gatewayDiagnostic;
  bool get speechOutputActive => _speechOutputActive;
  bool get autoSpeakTranslation => _autoSpeakTranslation;
  bool get voiceOutputUpdating => _voiceOutputUpdating;

  Future<void> pause() async {
    final session = _session;
    if (session == null || _status != RealtimeStatus.active) return;
    try {
      if (_usesDeviceAsr) {
        await _mobileAsrProvider?.stop();
        await _drainDeviceAsrStopEvents();
        await _drainAsrTextSegments();
      } else {
        await _audioCapture.stop();
      }
      await _audioSessionCoordinator.endCapture();
      await _stopSpeaking();
      if (!await _repository.pauseAndWait(session.sessionId)) {
        throw StateError('Realtime connection lost');
      }
      if (session.syncBinding != null) _resetPublicEndpoints();
      _setStatus(RealtimeStatus.paused);
      await _awaitLocalCheckpoint();
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

  Future<void> _resume({bool afterLifecycle = false}) async {
    final session = _session;
    if (session == null) return;
    final resumed = afterLifecycle
        ? await _repository.resumeAfterLifecycle(session.sessionId)
        : await _repository.resumeAndWait(session.sessionId);
    if (!resumed) {
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

  Future<void> _resumeAfterLifecycleOrFail() async {
    try {
      await _resume(afterLifecycle: true);
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

  bool _setStatus(RealtimeStatus status) {
    final transition = transitionRealtimeStatus(_status, status);
    if (!transition.accepted) return false;
    if (!transition.changed) return true;
    _activeTimeClock.transition(_status, status);
    _status = transition.current;
    _scheduleLocalCheckpoint();
    if (status == RealtimeStatus.active && _captureInvalidated) {
      unawaited(_recoverCaptureAfterAudioChange(rebuildOnly: true));
    }
    if (status != RealtimeStatus.active &&
        status != RealtimeStatus.connecting) {
      _captureInvalidated = false;
    }
    if (!isTerminalRealtimeStatus(status)) _message = null;
    _notify();
    return true;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _fail(String message) {
    _repository.invalidateResultSync();
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
    if (failedSession != null && _usesLocalCheckpoints) {
      await _saveFailedLocalCheckpoint(failedSession);
      return;
    }
    if (failedSession != null) {
      await ignoreCleanupError(() {
        return _repository.prepareFinalization(
          failedSession.sessionId,
          _finalizationSegments,
          billableSeconds: _activeTimeClock.billableSeconds,
        );
      });
      await ignoreCleanupError(() {
        return _repository.end(failedSession.sessionId, _finalizationSegments);
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

  Future<void> recoverPendingFinalizations() async {
    await ignoreCleanupError(_repository.recoverPendingFinalizations);
  }
}
