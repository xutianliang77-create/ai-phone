import 'dart:async';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_call_link_localizations.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../../shared/widgets/auto_follow_scroll_view.dart';
import '../../../account/presentation/widgets/account_required_panel.dart';
import '../../../compliance/data/voice_processing_consent_store.dart';
import '../../../compliance/presentation/widgets/voice_processing_consent_dialog.dart';
import '../../data/call_room_client.dart';
import '../../data/call_link_api_client.dart';
import '../../data/livekit_call_room_client.dart';
import '../widgets/call_room_captions.dart';
import '../widgets/call_link_result_panel.dart';

typedef CallLinkShareText = Future<void> Function(String text);

class CallLinkPage extends StatefulWidget {
  const CallLinkPage({
    this.client,
    this.roomClient,
    this.shareText,
    this.voiceConsentStore,
    super.key,
  });

  final CallLinkApiClient? client;
  final CallRoomClient? roomClient;
  final CallLinkShareText? shareText;
  final VoiceProcessingConsentStore? voiceConsentStore;

  @override
  State<CallLinkPage> createState() => _CallLinkPageState();
}

class _CallLinkPageState extends State<CallLinkPage> {
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
  CallRoomToken? _hostToken;
  CallLinkEndResult? _endResult;
  CallRoomSnapshot _roomSnapshot = const CallRoomSnapshot.disconnected();
  Object? _error;
  bool _loading = false;
  bool _roomLoading = false;

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
    if (_ownsRoomClient) unawaited(_roomClient.dispose());
    if (_ownsClient) _client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.startTranslationCall)),
      body: SafeArea(
        child: AutoFollowScrollView(
          tailKey: callRoomCaptionsTailKey(_roomSnapshot.captions),
          jumpToLatestLabel: l10n.isChinese ? '回到底部' : 'Back to latest',
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: <Widget>[
            Text(l10n.callLinkDomesticBody),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _loading ? null : _createLink,
              icon: const Icon(Icons.add_link),
              label: Text(l10n.generateCallLink),
            ),
            const SizedBox(height: 16),
            if (_loading) const LinearProgressIndicator(),
            if (_link != null)
              CallLinkResultPanel(
                link: _link!,
                hostToken: _hostToken,
                roomSnapshot: _roomSnapshot,
                roomBusy: _roomLoading,
                endResult: _endResult,
                onEnterRoom: _enterRoom,
                onEndRoom: _endRoom,
                onShare: _share,
              ),
            if (_error != null)
              isAccountAuthRequiredError(_error)
                  ? AccountRequiredPanel(
                      message: '发起翻译电话需要登录账号，用于保存通话记录和结算用量。',
                      onReturn: () {
                        if (!mounted) return;
                        setState(() => _error = null);
                      },
                    )
                  : Text(
                      l10n.errorMessage(_error!),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
          ],
        ),
      ),
    );
  }

  Future<void> _createLink() async {
    if (!await _ensureVoiceConsent()) return;
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
      _link = null;
      _hostToken = null;
      _endResult = null;
      _roomSnapshot = const CallRoomSnapshot.disconnected();
    });
    try {
      await _roomClient.disconnect();
      final link = await _client.createCallLink();
      if (!mounted) return;
      setState(() {
        _link = link;
        _hostToken = null;
      });
      final hostToken = await _client.createRoomToken(
        callId: link.callId,
        participantRole: 'host',
        participantName: 'host',
      );
      if (!mounted) return;
      setState(() => _hostToken = hostToken);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _enterRoom() async {
    final token = _hostToken;
    if (token == null || _roomLoading) return;
    if (!await _ensureVoiceConsent()) return;
    if (!mounted) return;
    setState(() {
      _roomLoading = true;
      _error = null;
    });
    try {
      await _roomClient.connect(token);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _roomLoading = false);
    }
  }

  Future<void> _endRoom() async {
    final link = _link;
    if (_roomLoading || link == null || _endResult != null) return;
    setState(() {
      _roomLoading = true;
      _error = null;
    });
    try {
      await _roomClient.disconnect();
      final result = await _client.endCallLink(callId: link.callId);
      if (mounted) setState(() => _endResult = result);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _roomLoading = false);
    }
  }

  Future<void> _share(String text) async {
    final shareText = widget.shareText;
    if (shareText != null) {
      await shareText(text);
      return;
    }
    await SharePlus.instance.share(ShareParams(text: text));
  }

  Future<bool> _ensureVoiceConsent() {
    return ensureVoiceProcessingConsent(
      context: context,
      store: _voiceConsentStore,
      scene: VoiceProcessingConsentScene.callLink,
    );
  }
}
