import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../voice_profile/data/voice_reference_recorder.dart';
import '../../data/voice_identity_api_client.dart';
import '../voice_identity_error_messages.dart';

const _consentVersion = 'domestic-voice-identity-v1';
const _minimumRecordingDurationMs = 5000;
const _maximumRecordingDurationMs = 15000;

class VoiceIdentityPage extends StatefulWidget {
  const VoiceIdentityPage({
    this.client,
    this.recorder,
    this.apiBaseUrl,
    super.key,
  });

  final VoiceIdentityClient? client;
  final VoiceReferenceRecorder? recorder;
  final Uri? apiBaseUrl;

  @override
  State<VoiceIdentityPage> createState() => _VoiceIdentityPageState();
}

class _VoiceIdentityPageState extends State<VoiceIdentityPage> {
  late final VoiceIdentityClient _client = widget.client ??
      VoiceIdentityApiClient(
        baseUrl: widget.apiBaseUrl ?? AppConfig.fromEnvironment().apiBaseUrl,
      );
  late final VoiceReferenceRecorder _recorder =
      widget.recorder ?? RecordVoiceReferenceRecorder();
  final TextEditingController _nameController = TextEditingController();
  List<VoiceIdentity> _identities = const [];
  String? _recordingId;
  String? _message;
  bool _consent = false;
  bool _loading = false;
  bool _loadFailed = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _recorder.dispose();
    final client = _client;
    if (widget.client == null && client is VoiceIdentityApiClient) {
      client.close();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final zh = Localizations.localeOf(context).languageCode == 'zh';
    final disabled = _busy || _loading;
    return Scaffold(
      appBar: AppBar(title: Text(zh ? '声音身份' : 'Voice identities')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            Text(zh
                ? '仅在你明确授权后保存加密声纹，用于在同传中显示说话人姓名。'
                : 'Encrypted voiceprints identify consented speakers in live translation.'),
            const SizedBox(height: 12),
            TextField(
              controller: _nameController,
              enabled: !disabled,
              decoration: InputDecoration(
                labelText: zh ? '说话人姓名' : 'Speaker name',
              ),
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _consent,
              onChanged: disabled
                  ? null
                  : (value) => setState(() => _consent = value ?? false),
              title: Text(zh ? '我已获得该说话人的明确授权' : 'Explicit consent obtained'),
              subtitle: Text(zh
                  ? '可随时撤销，撤销后不再参与识别。'
                  : 'Consent can be revoked at any time.'),
              controlAffinity: ListTileControlAffinity.leading,
            ),
            FilledButton.icon(
              onPressed: disabled ? null : _create,
              icon: const Icon(Icons.person_add_alt_1_outlined),
              label: Text(zh ? '新建声音身份' : 'Create identity'),
            ),
            if (_busy || _loading) ...[
              const SizedBox(height: 12),
              const LinearProgressIndicator(),
            ],
            if (_message != null) ...[
              const SizedBox(height: 12),
              Text(_message!),
            ],
            if (_loadFailed) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _loading ? null : _load,
                icon: const Icon(Icons.refresh),
                label: Text(zh ? '重试' : 'Retry'),
              ),
            ],
            const SizedBox(height: 16),
            ..._identities.map((identity) => _IdentityTile(
                  identity: identity,
                  recording: _recordingId == identity.id,
                  disabled: disabled,
                  zh: zh,
                  onRecord: () => _toggleRecording(identity),
                  onRevoke: () => _revoke(identity),
                  onDelete: () => _delete(identity),
                )),
          ],
        ),
      ),
    );
  }

  Future<void> _load() async {
    if (_loading || _busy) return;
    setState(() {
      _loading = true;
      _loadFailed = false;
      _message = null;
    });
    try {
      _identities = await _client.list();
    } on Object catch (error) {
      _loadFailed = true;
      _message = _loadErrorMessage(error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _loadErrorMessage(Object error) {
    if (error is TimeoutException) {
      return '连接服务器超时，请确认 Tailscale 已连接后重试';
    }
    if (error is VoiceIdentityApiException && error.statusCode == 401) {
      return '登录状态已失效，请重新登录后重试';
    }
    return '加载声音身份失败，请检查网络后重试';
  }

  Future<void> _create() async {
    final name = _nameController.text.trim();
    if (name.isEmpty || !_consent) {
      setState(() => _message = '请填写姓名并确认授权');
      return;
    }
    await _run(() async {
      final created = await _client.create(
        displayName: name,
        consentVersion: _consentVersion,
      );
      _identities = [..._identities, created];
      _nameController.clear();
      _consent = false;
      _message = '身份已创建，请录制 5 至 15 秒清晰语音';
    });
  }

  Future<void> _toggleRecording(VoiceIdentity identity) async {
    if (_recordingId == identity.id) {
      await _run(() async {
        late final VoiceReferenceRecording recording;
        try {
          recording = await _recorder.stop();
        } finally {
          _recordingId = null;
        }
        if (recording.durationMs < _minimumRecordingDurationMs) {
          _message = '录音时间太短，请自然说话 5 至 15 秒后再停止';
          return;
        }
        if (recording.durationMs > _maximumRecordingDurationMs) {
          _message = '录音时间太长，请控制在 5 至 15 秒内';
          return;
        }
        final enrolled = await _client.enroll(
          identityId: identity.id,
          audioBase64: base64Encode(recording.bytes),
        );
        _replace(enrolled);
        _message = '声音身份录入完成';
      });
      return;
    }
    try {
      await _recorder.start();
      if (!mounted) return;
      setState(() {
        _recordingId = identity.id;
        _message = '正在录音，请自然说话 5 至 15 秒';
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _message = '录音失败：$error');
    }
  }

  Future<void> _revoke(VoiceIdentity identity) => _run(() async {
        _replace(await _client.revoke(identity.id));
        _message = '授权已撤销';
      });

  Future<void> _delete(VoiceIdentity identity) => _run(() async {
        await _client.delete(identity.id);
        _identities =
            _identities.where((item) => item.id != identity.id).toList();
        _message = '声音身份已删除';
      });

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await action();
    } on Object catch (error) {
      _message = voiceIdentityOperationErrorMessage(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _replace(VoiceIdentity next) {
    _identities = _identities
        .map((item) => item.id == next.id ? next : item)
        .toList(growable: false);
  }
}

class _IdentityTile extends StatelessWidget {
  const _IdentityTile({
    required this.identity,
    required this.recording,
    required this.disabled,
    required this.zh,
    required this.onRecord,
    required this.onRevoke,
    required this.onDelete,
  });

  final VoiceIdentity identity;
  final bool recording;
  final bool disabled;
  final bool zh;
  final VoidCallback onRecord;
  final VoidCallback onRevoke;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.record_voice_over_outlined),
      title: Text(identity.displayName),
      subtitle: Text(_status),
      trailing: Wrap(
        spacing: 4,
        children: [
          if (identity.status == 'pending_enrollment')
            IconButton(
              onPressed: disabled ? null : onRecord,
              tooltip: recording ? '停止录音' : '录入声音',
              icon: Icon(recording ? Icons.stop : Icons.mic_none),
            ),
          if (identity.ready)
            IconButton(
              onPressed: disabled ? null : onRevoke,
              tooltip: '撤销授权',
              icon: const Icon(Icons.person_off_outlined),
            ),
          if (identity.status == 'pending_enrollment' ||
              identity.status == 'revoked')
            IconButton(
              onPressed: disabled || recording ? null : onDelete,
              tooltip: '删除',
              icon: const Icon(Icons.delete_outline),
            ),
        ],
      ),
    );
  }

  String get _status => switch (identity.status) {
        'pending_enrollment' => zh ? '待录入' : 'Enrollment required',
        'ready' => zh ? '已授权并启用' : 'Authorized and ready',
        'revoked' => zh ? '已撤销' : 'Revoked',
        _ => identity.status,
      };
}
