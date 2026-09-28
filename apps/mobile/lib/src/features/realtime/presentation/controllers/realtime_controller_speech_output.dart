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
    if (revision <= (_cancelledPublicAudioRevisions[segmentId] ?? -1)) return;
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
      if (generation != _speechGeneration ||
          !_canPlayPublicAudioRevision(segmentId, revision)) {
        return null;
      }
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
    await _publicAudioStopBarrier;
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
    if (generation != _speechGeneration ||
        !_canPlayPublicAudioRevision(segmentId, revision)) {
      return;
    }
    _activePublicAudioSegmentId = segmentId;
    _activePublicAudioRevision = revision;
    final cancellation = Completer<void>();
    _activePublicAudioCancellation = cancellation;
    _writeSpeechTiming(segmentId, <String, Object?>{
      'status': 'started',
      'provider': 'server_pcm_tts',
      'sampleRate': sampleRate,
      'revision': revision,
    });
    _speechCaptureGate.beginPlayback();
    _setSpeechOutputActive(true);
    try {
      final result = await Future.any<PcmAudioOutputResult?>([
        player.play(
            data: data,
            sampleRate: sampleRate,
          ),
        cancellation.future.then<PcmAudioOutputResult?>((_) => null),
      ]).timeout(const Duration(seconds: 30));
      if (result != null && isFinal && generation == _speechGeneration &&
          _canPlayPublicAudioRevision(segmentId, revision)) {
        _writeSpeechTiming(segmentId, <String, Object?>{
          'status': 'finished',
          'provider': result.provider,
          'sampleRate': result.sampleRate,
          'revision': revision,
        });
      }
    } on TimeoutException catch (error) {
      if (generation == _speechGeneration && _canPlayPublicAudioRevision(segmentId, revision)) {
        _cancelledPublicAudioRevisions[segmentId] = revision;
        _writeSpeechTiming(segmentId, <String, Object?>{
          'status': 'timed_out',
          'provider': 'server_pcm_tts',
          'sampleRate': sampleRate,
          'revision': revision,
        });
        await ignoreCleanupError(player.stop);
        if (generation == _speechGeneration) {
          _reportSpeechFailure(error, '语音播放超时',
              segmentId: segmentId, revision: revision);
        }
      }
    } on Object catch (error) {
      if (generation == _speechGeneration && _canPlayPublicAudioRevision(segmentId, revision)) {
        // Queued chunks of this utterance must not turn a partial playback
        // failure into a later "finished" receipt. A newer revision or a
        // different segment remains independently playable.
        _cancelledPublicAudioRevisions[segmentId] = revision;
        _writeSpeechTiming(segmentId, <String, Object?>{
          'status': 'failed',
          'provider': 'server_pcm_tts',
          'sampleRate': sampleRate,
          'revision': revision,
        });
        _reportSpeechFailure(error, '语音播放失败',
            segmentId: segmentId, revision: revision);
      }
    } finally {
      if (identical(_activePublicAudioCancellation, cancellation)) {
        _activePublicAudioCancellation = null;
      }
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

  bool _canPlayPublicAudioRevision(String segmentId, int revision) {
    final draft = _drafts[segmentId];
    return _status == RealtimeStatus.active &&
        _autoSpeakTranslation &&
        revision > (_cancelledPublicAudioRevisions[segmentId] ?? -1) &&
        draft?.revision == revision &&
        draft!.translatedText.trim().isNotEmpty;
  }

  void _cancelPublicAudioForRevision(String segmentId, int revision,
      {bool inclusive = true}) {
    final cutoff = inclusive ? revision : revision - 1;
    if (cutoff < 0) return;
    if (cutoff > (_cancelledPublicAudioRevisions[segmentId] ?? -1)) {
      _cancelledPublicAudioRevisions[segmentId] = cutoff;
    }
    final activeSegment = _activePublicAudioSegmentId;
    final activeRevision = _activePublicAudioRevision;
    // Queued jobs recheck this segment watermark. Never cancel another
    // caption or advance the whole session's playback generation here.
    if (activeSegment != segmentId || activeRevision == null ||
        activeRevision > cutoff || _pcmAudioOutputPlayer == null) return;
    final cancellation = _activePublicAudioCancellation;
    final stopping = _pcmAudioOutputPlayer.stop();
    _publicAudioStopBarrier = stopping;
    _writeSpeechTiming(segmentId, {'status':'superseded',
      'provider':'server_pcm_tts','revision':activeRevision});
    unawaited(stopping.then((_) {
      if (identical(_publicAudioStopBarrier, stopping)) _publicAudioStopBarrier = null;
      if (cancellation != null && !cancellation.isCompleted) cancellation.complete();
    }).catchError((Object error) {
      if (cancellation != null && !cancellation.isCompleted) cancellation.complete();
      _reportSpeechFailure(error, '停止朗读未确认', segmentId:segmentId, revision:activeRevision);
    }));
  }
}
