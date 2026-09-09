part of 'realtime_controller.dart';

extension RealtimeControllerSpeech on RealtimeController {
  Future<bool> setAutoSpeakTranslation(bool enabled,
      {String? voiceOutputMode}) async {
    if (_voiceOutputUpdating) return false;
    final mode = enabled
        ? (voiceOutputMode ??
            (_config.realtimeVoiceOutputMode == 'off'
                ? 'natural'
                : _config.realtimeVoiceOutputMode))
        : 'off';
    if (enabled && _config.useLocalSessions && mode == 'my_voice') {
      _reportSpeechFailure(
        StateError('本地模式暂不支持所选个人声音，请选择自然声音或切换在线'),
        '所选声音暂不可用',
      );
      return false;
    }
    if (_autoSpeakTranslation == enabled &&
        _config.realtimeVoiceOutputMode == mode) {
      return true;
    }
    _voiceOutputUpdating = true;
    _notify();
    final session = _session;
    try {
      if (!enabled) {
        _autoSpeakTranslation = false;
        _config = _config.copyWith(realtimeVoiceOutputMode: 'off');
        _repository.configureVoiceOutput('off');
        await _stopSpeaking();
        _notify();
      }
      if (session != null && !_config.useLocalSessions) {
        if (mode == 'my_voice' && _config.realtimeVoiceOutputMode != mode) {
          throw StateError('请结束当前会话后切换我的声音');
        }
        await _repository.setVoiceOutput(session.sessionId, enabled,
            presetId: mode == 'natural' ? _config.realtimeVoicePresetId : null);
        if (_disposed || _session != session || _stopInFlight) return false;
      }
      _config = _config.copyWith(realtimeVoiceOutputMode: mode);
      _repository.configureVoiceOutput(mode);
      _autoSpeakTranslation = enabled;
      _message = null;
      return true;
    } catch (error) {
      _reportSpeechFailure(error, '语音播报设置未确认');
      return !enabled;
    } finally {
      _voiceOutputUpdating = false;
      _notify();
    }
  }

  void _reportSpeechFailure(Object error, String action) {
    final detail = error is PlatformException
        ? error.message ?? error.code
        : displayRealtimeErrorMessage(error);
    _message = '$action：$detail。字幕已保留';
    unawaited(_recordDeviceAsrDiagnosticEvent('tts.failed', payload: {
      'message': detail,
      'action': action,
      if (error is PlatformException) 'code': error.code,
    }));
    _notify();
  }

  void _setSpeechOutputActive(bool active) {
    if (_speechOutputActive == active) return;
    _speechOutputActive = active;
    _notify();
  }

  void _speakTranslationIfNeeded(String text, String targetLanguage,
      {String? segmentId, bool Function()? isCurrent}) {
    final speaker = _speechOutputProvider;
    final speechText = text.trim();
    if (!_config.useLocalSessions ||
        _status != RealtimeStatus.active ||
        !_autoSpeakTranslation ||
        speaker == null ||
        speechText.isEmpty) {
      return;
    }
    if (_config.realtimeVoiceOutputMode == 'my_voice') {
      _reportSpeechFailure(
        StateError('个人声音需要对应在线语音能力，不能使用系统声音替代'),
        '所选声音暂不可用',
      );
      return;
    }
    final normalizedText =
        normalizeSpeechOutputText(speechText, targetLanguage);
    final generation = _speechGeneration;
    final queued = Stopwatch()..start();
    _speechChain = _speechChain.catchError((Object _) {}).then((_) {
      if (generation != _speechGeneration || isCurrent?.call() == false) {
        return null;
      }
      return _speakWithTimeout(speaker, normalizedText, targetLanguage,
          segmentId: segmentId,
          isCurrent: isCurrent,
          queueWaitMs: queued.elapsedMicroseconds / 1000);
    }).then<void>((_) {});
  }

  Future<void> _speakWithTimeout(
    SpeechOutputProvider speaker,
    String text,
    String language, {
    String? segmentId,
    bool Function()? isCurrent,
    double queueWaitMs = 0,
  }) async {
    final generation = _speechGeneration;
    await _recordDeviceAsrDiagnosticEvent(
      'tts.begin',
      payload: <String, Object?>{
        'text': text,
        'language': language,
        'route': 'system_speech',
        'requiresAcousticEchoSuppression':
            _speechCaptureGate.requiresAcousticEchoSuppression,
      },
    );
    if (generation != _speechGeneration ||
        _status != RealtimeStatus.active ||
        isCurrent?.call() == false) {
      return;
    }
    if (segmentId != null &&
        !_deviceAsrRecovery.speechStartedSegments.add(segmentId)) {
      return;
    }
    _speechCaptureGate.beginPlayback(text: text, language: language);
    _setSpeechOutputActive(true);
    try {
      final result =
          await speaker.speak(text: text, language: language).timeout(
                _speechTimeoutFor(text),
              );
      if (generation == _speechGeneration &&
          isCurrent?.call() != false &&
          segmentId != null) {
        final current = _drafts[segmentId];
        if (current != null) {
          _upsertSegment(segmentId, refinement: {
            ...?current.refinement,
            'speechTiming': {
              'status': 'finished',
              'queueWaitMs': queueWaitMs,
              ...result.timings,
              if (result.voice != null)
                'voiceIdentifier': result.voice!.identifier,
              if (result.voice != null) 'voiceLanguage': result.voice!.language,
              if (result.voice != null) 'voiceQuality': result.voice!.quality,
            },
          });
        }
      }
      if (generation == _speechGeneration &&
          isCurrent?.call() != false &&
          result.voice != null) {
        await _recordDeviceAsrDiagnosticEvent('tts.completed', payload: {
          'language': language,
          'voiceIdentifier': result.voice!.identifier,
          'voiceLanguage': result.voice!.language,
          'voiceQuality': result.voice!.quality,
        });
      }
    } on TimeoutException catch (error) {
      if (generation == _speechGeneration) {
        await ignoreCleanupError(speaker.stop);
        if (generation == _speechGeneration) {
          _reportSpeechFailure(error, '语音播放超时');
        }
      }
    } on Object catch (error) {
      if (generation == _speechGeneration) {
        _reportSpeechFailure(error, '语音播放失败');
      }
    } finally {
      if (generation == _speechGeneration) {
        _speechCaptureGate.endPlayback();
        _setSpeechOutputActive(false);
        await _recordDeviceAsrDiagnosticEvent(
          'tts.end',
          payload: <String, Object?>{
            'text': text,
            'language': language,
            'route': 'system_speech',
            'requiresAcousticEchoSuppression':
                _speechCaptureGate.requiresAcousticEchoSuppression,
          },
        );
      }
    }
  }

  Duration _speechTimeoutFor(String text) {
    final configured = _speechOutputTimeout;
    if (configured != null) return configured;
    final estimatedMs = 5000 + text.runes.length * 220;
    return Duration(milliseconds: estimatedMs.clamp(8000, 30000).toInt());
  }

  Future<void> _stopSpeaking() async {
    _speechGeneration += 1;
    unawaited(_recordDeviceAsrDiagnosticEvent(
      'tts.stop_requested',
      payload: <String, Object?>{
        'requiresAcousticEchoSuppression':
            _speechCaptureGate.requiresAcousticEchoSuppression,
      },
    ));
    _speechCaptureGate.reset();
    _setSpeechOutputActive(false);
    final stopping = Future.wait<void>([
      if (_speechOutputProvider != null) _speechOutputProvider.stop(),
      if (_pcmAudioOutputPlayer != null) _pcmAudioOutputPlayer.stop(),
    ]).then<void>((_) {});
    // New speech waits for stop acknowledgement, never for a cancelled speak
    // future that a platform may leave unresolved until its old timeout.
    _speechChain = stopping.catchError((Object _) {});
    await stopping;
  }

  void _playAudioOutputIfNeeded(GatewayRealtimeEvent event) {
    final player = _pcmAudioOutputPlayer;
    if (_config.useLocalSessions ||
        !_autoSpeakTranslation ||
        player == null ||
        event.format != 'pcm16' ||
        event.data == null ||
        event.sampleRate == null) {
      return;
    }
    final data = event.data!;
    final sampleRate = event.sampleRate!;
    final generation = _speechGeneration;
    _speechChain = _speechChain.catchError((Object _) {}).then((_) {
      if (generation != _speechGeneration) return null;
      return _playPcmWithTimeout(player, data, sampleRate);
    }).then<void>((_) {});
  }

  Future<void> _playPcmWithTimeout(
    PcmAudioOutputPlayer player,
    String data,
    int sampleRate,
  ) async {
    final generation = _speechGeneration;
    await _recordDeviceAsrDiagnosticEvent(
      'tts.begin',
      payload: <String, Object?>{
        'format': 'pcm16',
        'sampleRate': sampleRate,
        'base64Length': data.length,
        'route': 'pcm_player',
        'requiresAcousticEchoSuppression':
            _speechCaptureGate.requiresAcousticEchoSuppression,
      },
    );
    if (generation != _speechGeneration || _status != RealtimeStatus.active) {
      return;
    }
    _speechCaptureGate.beginPlayback();
    _setSpeechOutputActive(true);
    try {
      await player
          .play(
            data: data,
            sampleRate: sampleRate,
          )
          .timeout(const Duration(seconds: 30));
    } on TimeoutException catch (error) {
      if (generation == _speechGeneration) {
        await ignoreCleanupError(player.stop);
        if (generation == _speechGeneration) {
          _reportSpeechFailure(error, '语音播放超时');
        }
      }
    } on Object catch (error) {
      if (generation == _speechGeneration) {
        _reportSpeechFailure(error, '语音播放失败');
      }
    } finally {
      if (generation == _speechGeneration) {
        _speechCaptureGate.endPlayback();
        _setSpeechOutputActive(false);
        await _recordDeviceAsrDiagnosticEvent(
          'tts.end',
          payload: <String, Object?>{
            'format': 'pcm16',
            'sampleRate': sampleRate,
            'route': 'pcm_player',
            'requiresAcousticEchoSuppression':
                _speechCaptureGate.requiresAcousticEchoSuppression,
          },
        );
      }
    }
  }
}
