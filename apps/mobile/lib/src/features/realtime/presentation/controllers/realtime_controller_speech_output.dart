part of 'realtime_controller.dart';

extension _RealtimeControllerSpeechOutput on RealtimeController {
  void _queueSpeechTiming(String? segmentId, int generation) {
    if (segmentId == null) return;
    _speechQueuedSegments.putIfAbsent(
        generation, () => <String, double>{})[segmentId] = 0;
    _writeSpeechTiming(segmentId, const <String, Object?>{'status': 'queued'});
  }

  void _markSpeechStarted(
      String? segmentId, int generation, double queueWaitMs) {
    if (segmentId == null) return;
    _activeSpeechSegmentId = segmentId;
    _activeSpeechGeneration = generation;
    _speechQueuedSegments[generation]?[segmentId] = queueWaitMs;
    _writeSpeechTiming(segmentId, {
      'status': 'started',
      'queueWaitMs': queueWaitMs,
    });
  }

  void _markSpeechFinished(String segmentId, int generation, double queueWaitMs,
      SpeechOutputResult result) {
    _removeQueuedSpeech(segmentId, generation);
    _writeSpeechTiming(segmentId, {
      'status': 'finished',
      'queueWaitMs': queueWaitMs,
      ...result.timings,
      if (result.voice != null) 'voiceIdentifier': result.voice!.identifier,
      if (result.voice != null) 'voiceLanguage': result.voice!.language,
      if (result.voice != null) 'voiceQuality': result.voice!.quality,
    });
  }

  void _markSpeechTerminal(String? segmentId, int generation, String status) {
    if (segmentId == null) return;
    final queueWaitMs = _removeQueuedSpeech(segmentId, generation);
    _writeSpeechTiming(segmentId, {
      'status': status,
      if (queueWaitMs != null) 'queueWaitMs': queueWaitMs,
    });
  }

  double? _removeQueuedSpeech(String segmentId, int generation) {
    final queued = _speechQueuedSegments[generation];
    final queueWaitMs = queued?.remove(segmentId);
    if (queued?.isEmpty ?? false) _speechQueuedSegments.remove(generation);
    return queueWaitMs;
  }

  void _clearActiveSpeech(String? segmentId, int generation) {
    if (segmentId == null ||
        _activeSpeechGeneration != generation ||
        _activeSpeechSegmentId != segmentId) {
      return;
    }
    _activeSpeechGeneration = null;
    _activeSpeechSegmentId = null;
  }

  void _writeSpeechTiming(String segmentId, Map<String, Object?> speechTiming) {
    final current = _drafts[segmentId];
    if (current == null) return;
    _upsertSegment(segmentId, refinement: {
      ...?current.refinement,
      'speechTiming': speechTiming,
    });
  }

  void _playAudioOutputIfNeeded(GatewayRealtimeEvent event) {
    final player = _pcmAudioOutputPlayer;
    if (_config.useLocalSessions ||
        !_autoSpeakTranslation ||
        player == null ||
        event.segmentId == null ||
        event.revision == null ||
        event.revision! < 0 ||
        event.sequence == null ||
        event.sequence! < 0 ||
        event.format != 'pcm16' ||
        event.data == null ||
        event.sampleRate == null) {
      return;
    }
    final segmentId = event.segmentId!;
    final revision = event.revision!;
    final draft = _drafts[segmentId];
    // Public TTS belongs only to a current translated revision.  A delayed
    // audio frame must not revive a superseded subtitle or play after a newer
    // ASR/MT correction has cleared its translation.
    if (draft == null ||
        draft.revision != revision ||
        draft.translatedText.trim().isEmpty) {
      return;
    }
    final previousRevision = _publicAudioRevisionBySegment[segmentId];
    final previousSequence = _publicAudioSequenceBySegment[segmentId];
    if ((previousRevision != null && revision < previousRevision) ||
        (previousRevision == revision &&
            previousSequence != null && event.sequence! <= previousSequence)) {
      return;
    }
    _publicAudioRevisionBySegment[segmentId] = revision;
    _publicAudioSequenceBySegment[segmentId] = event.sequence!;
    final data = event.data!;
    final sampleRate = event.sampleRate!;
    final generation = _speechGeneration;
    _speechChain = _speechChain.catchError((Object _) {}).then((_) {
      if (generation != _speechGeneration) return null;
      return _playPcmWithTimeout(
        player,
        data,
        sampleRate,
        segmentId: segmentId,
        revision: revision,
        isFinal: event.isFinal == true,
      );
    }).then<void>((_) {});
  }

  Future<void> _playPcmWithTimeout(
    PcmAudioOutputPlayer player,
    String data,
    int sampleRate,
    {
      required String segmentId,
      required int revision,
      required bool isFinal,
    }
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
    _activePublicAudioSegmentId = segmentId;
    _activePublicAudioRevision = revision;
    _writeSpeechTiming(segmentId, <String, Object?>{
      'status': 'started',
      'provider': 'server_pcm_tts',
      'sampleRate': sampleRate,
      'revision': revision,
    });
    _speechCaptureGate.beginPlayback();
    _setSpeechOutputActive(true);
    try {
      final result = await player
          .play(
            data: data,
            sampleRate: sampleRate,
          )
          .timeout(const Duration(seconds: 30));
      if (isFinal && generation == _speechGeneration) {
        _writeSpeechTiming(segmentId, <String, Object?>{
          'status': 'finished',
          'provider': result.provider,
          'sampleRate': result.sampleRate,
          'revision': revision,
        });
      }
    } on TimeoutException catch (error) {
      if (generation == _speechGeneration) {
        _writeSpeechTiming(segmentId, <String, Object?>{
          'status': 'timed_out',
          'provider': 'server_pcm_tts',
          'sampleRate': sampleRate,
          'revision': revision,
        });
        await ignoreCleanupError(player.stop);
        if (generation == _speechGeneration) {
          _reportSpeechFailure(error, '语音播放超时');
        }
      }
    } on Object catch (error) {
      if (generation == _speechGeneration) {
        _writeSpeechTiming(segmentId, <String, Object?>{
          'status': 'failed',
          'provider': 'server_pcm_tts',
          'sampleRate': sampleRate,
          'revision': revision,
        });
        _reportSpeechFailure(error, '语音播放失败');
      }
    } finally {
      if (_activePublicAudioSegmentId == segmentId &&
          _activePublicAudioRevision == revision) {
        _activePublicAudioSegmentId = null;
        _activePublicAudioRevision = null;
      }
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

  void _cancelPublicAudioForRevision(String segmentId, int revision) {
    final activeSegment = _activePublicAudioSegmentId;
    final activeRevision = _activePublicAudioRevision;
    final queuedRevision = _publicAudioRevisionBySegment[segmentId];
    // `_speechChain` serializes PCM frames.  It can therefore contain an old
    // frame which is not the active player invocation yet.  Treat that queued
    // frame exactly like active audio: advance the generation so neither it
    // nor the active frame can resume after a newer subtitle revision.
    if ((activeSegment == segmentId &&
            activeRevision != null &&
            activeRevision <= revision) ||
        (queuedRevision != null && queuedRevision <= revision)) {
      unawaited(_stopSpeaking());
    }
  }
}
