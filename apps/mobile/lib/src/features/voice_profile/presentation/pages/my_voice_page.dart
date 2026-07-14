import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../../platform/diagnostics/app_error_reporter.dart';
import '../../../../platform/speech/pcm_audio_output_player.dart';
import '../../data/voice_profile_api_client.dart';
import '../../data/voice_reference_recorder.dart';
import 'my_voice_constants.dart';
import 'my_voice_diagnostics.dart';
import 'my_voice_page_messages.dart';
import 'my_voice_recording_errors.dart';
import 'my_voice_status_tile.dart';

class MyVoicePage extends StatefulWidget {
  const MyVoicePage({
    this.apiBaseUrl,
    this.client,
    this.recorder,
    this.audioPlayer,
    this.errorReporter,
    super.key,
  });

  final Uri? apiBaseUrl;
  final VoiceProfileClient? client;
  final VoiceReferenceRecorder? recorder;
  final PcmAudioOutputPlayer? audioPlayer;
  final AppErrorReporter? errorReporter;

  @override
  State<MyVoicePage> createState() => _MyVoicePageState();
}

class _MyVoicePageState extends State<MyVoicePage> {
  late final VoiceProfileClient _client = widget.client ??
      VoiceProfileApiClient(
        baseUrl: widget.apiBaseUrl ?? AppConfig.fromEnvironment().apiBaseUrl,
      );
  late final VoiceReferenceRecorder _recorder =
      widget.recorder ?? RecordVoiceReferenceRecorder();
  late final PcmAudioOutputPlayer _audioPlayer =
      widget.audioPlayer ?? SystemPcmAudioOutputPlayer();
  late final AppErrorReporter _errorReporter = widget.errorReporter ??
      AppErrorReporter.fromConfig(AppConfig.fromEnvironment());
  late final bool _ownsClient = widget.client == null;
  late final bool _ownsRecorder = widget.recorder == null;
  late final bool _ownsErrorReporter = widget.errorReporter == null;
  VoiceProfile? _profile;
  bool _loading = true;
  bool _recording = false;
  bool _testingVoice = false;
  String? _message;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  @override
  void dispose() {
    if (_ownsClient && _client is VoiceProfileApiClient) {
      _client.close();
    }
    if (_ownsRecorder) unawaited(_recorder.dispose());
    if (_ownsErrorReporter) _errorReporter.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.myVoiceTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: <Widget>[
            if (_loading) const LinearProgressIndicator(),
            if (_message != null) ...<Widget>[
              const SizedBox(height: 8),
              Text(_message!),
            ],
            MyVoiceStatusTile(
              icon: Icons.record_voice_over_outlined,
              title: l10n.myVoiceProfile,
              value: _profile?.displayName ?? l10n.myVoiceNotCreated,
            ),
            MyVoiceStatusTile(
              icon: Icons.graphic_eq_outlined,
              title: l10n.myVoiceCurrentOutput,
              value: _profile?.ready == true
                  ? l10n.myVoicePersonalOutput
                  : l10n.myVoiceNaturalVoice,
            ),
            MyVoiceStatusTile(
              icon: Icons.verified_user_outlined,
              title: l10n.myVoiceDataControl,
              value: _profile == null
                  ? l10n.myVoiceConsentRequired
                  : l10n.myVoiceConsentRecorded,
            ),
            if (_profile != null && !_profile!.ready)
              MyVoiceStatusTile(
                icon: Icons.mic_none,
                title: l10n.myVoicePendingReference,
                value: _profile!.status,
              ),
            if (_profile?.referenceQuality != null)
              MyVoiceStatusTile(
                icon: Icons.multiline_chart,
                title: l10n.text('myVoiceQuality'),
                value: l10n.text('myVoiceQualityPassed'),
              ),
            if (_profile != null && !_profile!.ready) ...<Widget>[
              const SizedBox(height: 12),
              Text(l10n.text('myVoiceReferencePrompt')),
            ],
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _loading || _profile != null ? null : _createProfile,
              icon: const Icon(Icons.mic_none),
              label: Text(l10n.myVoiceCreate),
            ),
            if (_profile != null && !_profile!.ready) ...<Widget>[
              const SizedBox(height: 8),
              FilledButton.icon(
                onPressed: _loading
                    ? null
                    : _recording
                        ? _stopRecordingAndUpload
                        : _startRecording,
                icon: Icon(_recording ? Icons.stop : Icons.fiber_manual_record),
                label: Text(
                  _recording
                      ? l10n.text('myVoiceStopAndUpload')
                      : l10n.text('myVoiceStartRecording'),
                ),
              ),
              if (_recording) ...<Widget>[
                const SizedBox(height: 8),
                Text(l10n.text('myVoiceRecording')),
              ],
            ],
            if (_profile?.ready == true) ...<Widget>[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _loading || _recording || _testingVoice
                    ? null
                    : () => _testVoice('natural'),
                icon: const Icon(Icons.volume_up_outlined),
                label: Text(l10n.text('myVoiceTestNatural')),
              ),
              const SizedBox(height: 8),
              FilledButton.tonalIcon(
                onPressed: _loading || _recording || _testingVoice
                    ? null
                    : () => _testVoice('clone'),
                icon: Icon(
                    _testingVoice ? Icons.hourglass_empty : Icons.play_arrow),
                label: Text(
                  _testingVoice
                      ? l10n.text('myVoiceTesting')
                      : l10n.text('myVoiceTest'),
                ),
              ),
            ],
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _loading || _recording || _profile == null
                  ? null
                  : _deleteProfile,
              icon: const Icon(Icons.delete_outline),
              label: Text(l10n.myVoiceDelete),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _loadProfile() async {
    setState(() {
      _loading = true;
      _message = null;
    });
    try {
      final profile = await _client.fetchMyProfile();
      if (!mounted) return;
      setState(() => _profile = profile);
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _message = myVoicePageFriendlyError(context.l10n, error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _createProfile() async {
    final l10n = context.l10n;
    setState(() {
      _loading = true;
      _message = null;
    });
    try {
      final profile = await _client.createMyProfile(
        consentVersion: voiceProfileConsentVersion,
        consentAcceptedAt: DateTime.now(),
      );
      if (!mounted) return;
      setState(() {
        _profile = profile;
        _message = l10n.myVoiceCreateSuccess;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _message = myVoicePageFriendlyError(context.l10n, error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _deleteProfile() async {
    final l10n = context.l10n;
    setState(() {
      _loading = true;
      _message = null;
    });
    try {
      await _client.deleteMyProfile();
      if (!mounted) return;
      setState(() {
        _profile = null;
        _message = l10n.myVoiceDeleteSuccess;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _message = myVoicePageFriendlyError(context.l10n, error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _startRecording() async {
    final l10n = context.l10n;
    setState(() {
      _loading = true;
      _message = null;
    });
    try {
      await _recorder.start();
      if (!mounted) return;
      setState(() {
        _recording = true;
        _message = l10n.text('myVoiceRecording');
      });
    } on Object catch (error, stackTrace) {
      reportVoiceReferenceError(
        _errorReporter,
        error,
        stackTrace,
        stage: 'start_recording',
        profileStatus: _profile?.status,
        recording: _recording,
      );
      if (!mounted) return;
      setState(() => _message = voiceRecordingErrorMessage(l10n, error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _stopRecordingAndUpload() async {
    final l10n = context.l10n;
    setState(() {
      _loading = true;
      _message = null;
    });
    try {
      final recording = await _recorder.stop();
      if (!mounted) return;
      setState(() => _recording = false);
      final durationError = voiceReferenceDurationError(
        l10n,
        recording.durationMs,
      );
      if (durationError != null) {
        setState(() => _message = durationError);
        return;
      }
      final profile = await _client.uploadReferenceAudio(
        audioBase64: base64Encode(recording.bytes),
        durationMs: recording.durationMs,
        mimeType: recording.mimeType,
        referenceTranscript: l10n.text('myVoiceReferenceTranscript'),
      );
      if (!mounted) return;
      setState(() {
        _profile = profile;
        _message = l10n.text('myVoiceUploadSuccess');
      });
    } on Object catch (error, stackTrace) {
      reportVoiceReferenceError(
        _errorReporter,
        error,
        stackTrace,
        stage: 'stop_upload_recording',
        profileStatus: _profile?.status,
        recording: _recording,
      );
      if (!mounted) return;
      setState(() {
        _recording = false;
        _message = voiceUploadErrorMessage(l10n, error);
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _testVoice(String variant) async {
    final l10n = context.l10n;
    setState(() {
      _testingVoice = true;
      _message = l10n.text('myVoiceTesting');
    });
    try {
      final result = await _client.testMyVoice(variant: variant);
      await _audioPlayer.play(
        data: result.audio.data,
        sampleRate: result.audio.sampleRate,
      );
      if (!mounted) return;
      setState(() => _message = l10n.text('myVoiceTestSuccess'));
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _message = voiceTestErrorMessage(l10n, error));
    } finally {
      if (mounted) setState(() => _testingVoice = false);
    }
  }
}
