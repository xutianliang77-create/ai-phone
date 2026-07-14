import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_call_link_localizations.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../../shared/widgets/auto_follow_scroll_view.dart';
import '../../../compliance/data/voice_processing_consent_store.dart';
import '../../../compliance/presentation/widgets/voice_processing_consent_dialog.dart';
import '../../data/call_link_api_client.dart';
import '../../data/call_room_client.dart';
import '../../data/livekit_call_room_client.dart';
import '../widgets/call_room_captions.dart';

class JoinCallLinkPage extends StatefulWidget {
  const JoinCallLinkPage({
    this.client,
    this.roomClient,
    this.voiceConsentStore,
    super.key,
  });

  final CallLinkApiClient? client;
  final CallRoomClient? roomClient;
  final VoiceProcessingConsentStore? voiceConsentStore;

  @override
  State<JoinCallLinkPage> createState() => _JoinCallLinkPageState();
}

class _JoinCallLinkPageState extends State<JoinCallLinkPage> {
  final _controller = TextEditingController();
  late final CallLinkApiClient _client = widget.client ??
      CallLinkApiClient(baseUrl: AppConfig.fromEnvironment().apiBaseUrl);
  late final bool _ownsClient = widget.client == null;
  late final CallRoomClient _roomClient =
      widget.roomClient ?? LiveKitCallRoomClient();
  late final bool _ownsRoomClient = widget.roomClient == null;
  late final VoiceProcessingConsentStore _voiceConsentStore =
      widget.voiceConsentStore ?? const FileVoiceProcessingConsentStore();
  StreamSubscription<CallRoomSnapshot>? _roomSubscription;
  CallLink? _link;
  CallRoomToken? _guestToken;
  CallRoomSnapshot _roomSnapshot = const CallRoomSnapshot.disconnected();
  Object? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _roomSubscription = _roomClient.snapshots.listen((snapshot) {
      if (!mounted) return;
      setState(() => _roomSnapshot = snapshot);
    });
  }

  @override
  void dispose() {
    unawaited(_roomSubscription?.cancel());
    _controller.dispose();
    if (_ownsRoomClient) unawaited(_roomClient.dispose());
    if (_ownsClient) _client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final joined = _roomSnapshot.status == CallRoomConnectionStatus.connected ||
        _roomSnapshot.status == CallRoomConnectionStatus.reconnecting;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.joinCallLink)),
      body: SafeArea(
        child: AutoFollowScrollView(
          tailKey: callRoomCaptionsTailKey(_roomSnapshot.captions),
          jumpToLatestLabel: l10n.isChinese ? '回到底部' : 'Back to latest',
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: <Widget>[
            Text(l10n.joinCallDomesticBody),
            const SizedBox(height: 16),
            TextField(
              controller: _controller,
              enabled: !joined && !_loading,
              decoration: InputDecoration(
                labelText: l10n.joinCallLinkInput,
                prefixIcon: const Icon(Icons.link),
              ),
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _join(),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _loading
                  ? null
                  : joined
                      ? _leave
                      : _join,
              icon: Icon(joined ? Icons.call_end : Icons.login),
              label: Text(joined ? l10n.leaveCallRoom : l10n.joinCallRoom),
            ),
            const SizedBox(height: 16),
            if (_loading) const LinearProgressIndicator(),
            if (_link != null) ...[
              Text('${l10n.callRoomName}：${_link!.roomName}'),
              const SizedBox(height: 4),
              Text('${l10n.callRoomProvider}：${_link!.roomProvider}'),
              const SizedBox(height: 8),
              _GuestTokenStatus(ready: _guestToken != null),
              const SizedBox(height: 12),
              _CallRoomStatus(snapshot: _roomSnapshot),
              CallRoomCaptions(
                captions: _roomSnapshot.captions,
                localRole: 'guest',
              ),
            ],
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  l10n.errorMessage(_error!),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _join() async {
    if (_loading) return;
    final callId = _callIdFromInput(_controller.text);
    if (callId == null) {
      setState(() => _error = context.l10n.joinCallLinkInvalid);
      return;
    }
    if (!await _ensureVoiceConsent()) return;
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
      _link = null;
      _guestToken = null;
      _roomSnapshot = const CallRoomSnapshot.disconnected();
    });
    try {
      await _roomClient.disconnect();
      final link = await _client.getCallLink(callId: callId);
      final token = await _client.createRoomToken(
        callId: link.callId,
        participantRole: 'guest',
        participantName: 'guest',
      );
      if (!mounted) return;
      setState(() {
        _link = link;
        _guestToken = token;
      });
      try {
        await _roomClient.connect(token);
        await _client.confirmRoomConnected(token);
      } catch (_) {
        await _roomClient.disconnect();
        rethrow;
      }
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _leave() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await _roomClient.disconnect();
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<bool> _ensureVoiceConsent() {
    return ensureVoiceProcessingConsent(
      context: context,
      store: _voiceConsentStore,
      scene: VoiceProcessingConsentScene.callLink,
    );
  }
}

class _GuestTokenStatus extends StatelessWidget {
  const _GuestTokenStatus({required this.ready});

  final bool ready;

  @override
  Widget build(BuildContext context) {
    final color = ready
        ? Theme.of(context).colorScheme.primary
        : Theme.of(context).colorScheme.error;
    return Row(
      children: <Widget>[
        Icon(
          ready ? Icons.check_circle : Icons.error_outline,
          size: 18,
          color: color,
        ),
        const SizedBox(width: 8),
        Expanded(child: Text(context.l10n.guestRoomTokenReady)),
      ],
    );
  }
}

class _CallRoomStatus extends StatelessWidget {
  const _CallRoomStatus({required this.snapshot});

  final CallRoomSnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text('${l10n.callRoomConnectionStatus}：${_statusText(l10n)}'),
        const SizedBox(height: 4),
        Text(
          '${l10n.callRoomRemoteParticipants}：'
          '${snapshot.remoteParticipantCount}',
        ),
        if (snapshot.message != null) ...[
          const SizedBox(height: 4),
          Text(snapshot.message!),
        ],
      ],
    );
  }

  String _statusText(AppLocalizations l10n) {
    return switch (snapshot.status) {
      CallRoomConnectionStatus.connecting => l10n.callRoomConnecting,
      CallRoomConnectionStatus.connected => snapshot.microphoneEnabled
          ? l10n.callRoomConnected
          : l10n.callRoomConnectedNoMic,
      CallRoomConnectionStatus.reconnecting => l10n.callRoomReconnecting,
      CallRoomConnectionStatus.disconnected => l10n.callRoomDisconnected,
    };
  }
}

String? _callIdFromInput(String input) {
  final trimmed = input.trim();
  if (trimmed.isEmpty) return null;
  final uri = Uri.tryParse(trimmed);
  final segments = uri?.pathSegments ?? const <String>[];
  final joinIndex = segments.indexOf('join');
  if (joinIndex >= 0 && joinIndex + 1 < segments.length) {
    return _validCallId(segments[joinIndex + 1]);
  }
  if (segments.isNotEmpty && uri?.hasScheme == true) {
    return _validCallId(segments.last);
  }
  return _validCallId(trimmed);
}

String? _validCallId(String value) {
  final cleaned = value.trim();
  if (RegExp(r'^[A-Za-z0-9_-]{3,120}$').hasMatch(cleaned)) return cleaned;
  return null;
}
