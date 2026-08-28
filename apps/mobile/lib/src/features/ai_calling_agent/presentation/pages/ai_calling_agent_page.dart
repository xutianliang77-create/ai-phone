import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../account/presentation/widgets/account_required_panel.dart';
import '../../../call_link/data/call_link_api_client.dart';
import '../../../call_link/data/call_room_client.dart';
import '../../../call_link/data/livekit_call_room_client.dart';
import '../../../compliance/data/voice_processing_consent_store.dart';
import '../../../compliance/presentation/widgets/voice_processing_consent_dialog.dart';
import '../../data/ai_calling_agent_api_client.dart';
import '../../data/agent_voice_control_controller.dart';
import '../ai_calling_agent_policy.dart';
import '../widgets/ai_calling_agent_draft_panel.dart';
import '../widgets/ai_calling_agent_form.dart';
import '../widgets/ai_calling_agent_intro.dart';
import '../widgets/ai_calling_agent_stage_bar.dart';
import '../widgets/ai_calling_agent_task_list.dart';
import 'agent_call_takeover_page.dart';

part 'ai_calling_agent_actions.dart';
part 'ai_calling_agent_lifecycle.dart';
part 'ai_calling_agent_voice_control.dart';

const _consentPromptVersion = 'domestic-ai-agent-consent-v1';
const _disclosurePromptVersion = 'domestic-ai-agent-disclosure-v1';

class AiCallingAgentPage extends StatefulWidget {
  const AiCallingAgentPage({
    this.client,
    this.callClient,
    this.roomClient,
    this.voiceConsentStore,
    this.voiceControlEnabled,
    super.key,
  });

  final AiCallingAgentApiClient? client;
  final CallLinkApiClient? callClient;
  final CallRoomClient? roomClient;
  final VoiceProcessingConsentStore? voiceConsentStore;
  final bool? voiceControlEnabled;

  @override
  State<AiCallingAgentPage> createState() => _AiCallingAgentPageState();
}

class _AiCallingAgentPageState extends State<AiCallingAgentPage> {
  late final AppConfig _config = AppConfig.fromEnvironment();
  late final AiCallingAgentApiClient _client = widget.client ??
      AiCallingAgentApiClient(baseUrl: _config.apiBaseUrl);
  late final bool _ownsClient = widget.client == null;
  late final CallLinkApiClient _callClient = widget.callClient ??
      CallLinkApiClient(baseUrl: _config.apiBaseUrl);
  late final CallRoomClient _roomClient =
      widget.roomClient ?? LiveKitCallRoomClient();
  late final bool _ownsRoomClient = widget.roomClient == null;
  late final bool _voiceControlEnabled = widget.voiceControlEnabled ??
      (_config.voiceAgentBackgroundWorkEnabled &&
          _config.voiceAgentOwnershipEnabled &&
          _config.voiceAgentDeliveryCoordinatorEnabled);
  late final AgentVoiceControlController? _voiceControl =
      _voiceControlEnabled
          ? AgentVoiceControlController(api: _client, room: _roomClient)
          : null;
  late final VoiceProcessingConsentStore _voiceConsentStore =
      widget.voiceConsentStore ?? const FileVoiceProcessingConsentStore();
  final TextEditingController _targetNameController = TextEditingController();
  final TextEditingController _targetPhoneController = TextEditingController();
  final TextEditingController _objectiveController = TextEditingController();
  final GlobalKey _draftPanelKey = GlobalKey();
  String _scenario = 'booking';
  AiCallingAgentDraft? _draft;
  List<AiCallingAgentDraft> _drafts = const <AiCallingAgentDraft>[];
  String? _notice;
  Object? _error;
  Object? _draftsError;
  bool _loading = false;
  bool _draftsLoading = false;
  bool _recipientDisclosureConfirmed = false;
  StreamSubscription<CallRoomSnapshot>? _roomSubscription;
  StreamSubscription<AgentVoiceControlSnapshot>? _voiceControlSubscription;
  Timer? _pollTimer;
  CallRoomSnapshot _roomSnapshot = const CallRoomSnapshot.disconnected();
  String? _roomCallId;
  Future<void>? _roomSync;
  AgentVoiceControlSnapshot _voiceControlSnapshot =
      const AgentVoiceControlSnapshot();

  void _updateState(VoidCallback update) => setState(update);

  @override
  void initState() {
    super.initState();
    _roomSubscription = _roomClient.snapshots.listen((snapshot) {
      if (mounted) setState(() => _roomSnapshot = snapshot);
    });
    _voiceControlSubscription = _voiceControl?.snapshots.listen((snapshot) {
      if (mounted) setState(() => _voiceControlSnapshot = snapshot);
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadDrafts());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    unawaited(_roomSubscription?.cancel());
    unawaited(_voiceControlSubscription?.cancel());
    unawaited(_voiceControl?.dispose());
    if (_ownsRoomClient) unawaited(_roomClient.dispose());
    _targetNameController.dispose();
    _targetPhoneController.dispose();
    _objectiveController.dispose();
    if (widget.callClient == null) _callClient.close();
    if (_ownsClient) _client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('AI 代打电话')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: <Widget>[
            const AiCallingAgentIntro(),
            const SizedBox(height: 16),
            AiCallingAgentStageBar(status: _draft?.status),
            const SizedBox(height: 20),
            AiCallingAgentForm(
              scenario: _scenario,
              targetNameController: _targetNameController,
              targetPhoneController: _targetPhoneController,
              objectiveController: _objectiveController,
              disclosureConfirmed: _recipientDisclosureConfirmed,
              busy: _loading,
              onScenarioChanged: (value) => setState(() => _scenario = value),
              onDisclosureChanged: (value) => setState(
                () => _recipientDisclosureConfirmed = value,
              ),
              onCreateDraft: _createDraft,
            ),
            if (_loading) ...[
              const SizedBox(height: 12),
              const LinearProgressIndicator(),
            ],
            if (_notice != null) ...[
              const SizedBox(height: 12),
              Text(_notice!,
                  style:
                      TextStyle(color: Theme.of(context).colorScheme.primary)),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              isAccountAuthRequiredError(_error)
                  ? AccountRequiredPanel(
                      message: 'AI 代打电话需要登录账号，用于保存授权、任务状态和用量记录。',
                      onReturn: () {
                        if (!mounted) return;
                        setState(() => _error = null);
                      },
                    )
                  : Text(
                      agentCallErrorMessage(_error!),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
            ],
            if (_draft != null) ...[
              const SizedBox(height: 16),
              if (_roomSnapshot.status != CallRoomConnectionStatus.disconnected)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    'LiveKit 监听：${_roomStatusText(_roomSnapshot.status)} · '
                    '麦克风：${_roomSnapshot.microphoneEnabled ? '已开启' : '已关闭'}',
                  ),
                ),
              if (_voiceControlEnabled) _buildVoiceControlPanel(),
              AiCallingAgentDraftPanel(
                key: _draftPanelKey,
                draft: _draft!,
                busy: _loading,
                onAuthorize: _authorizeDraft,
                onStart: _startDraft,
                onRefresh: _refreshDraft,
                onPause: _pauseAgent,
                onResume: _resumeAgent,
                onTakeover: _requestTakeover,
                onCancel: _cancelDraft,
              ),
            ],
            const SizedBox(height: 16),
            const Divider(),
            AiCallingAgentTaskList(
              drafts: _drafts,
              loading: _draftsLoading,
              error: _draftsError,
              selectedDraftId: _draft?.id,
              onRefresh: _loadDrafts,
              onSelect: _selectDraft,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _loading = true;
      _error = null;
      _notice = null;
    });
    try {
      await action();
    } catch (error) {
      _error = error;
    } finally {
      if (mounted) {
        setState(() => _loading = false);
        if (_draft != null) _scrollToDraft();
      }
    }
  }

  void _scrollToDraft() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final context = _draftPanelKey.currentContext;
      if (context == null) return;
      Scrollable.ensureVisible(
        context,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  Future<bool> _ensureVoiceConsent() {
    return ensureVoiceProcessingConsent(
      context: context,
      store: _voiceConsentStore,
      scene: VoiceProcessingConsentScene.aiCallingAgent,
    );
  }
}
