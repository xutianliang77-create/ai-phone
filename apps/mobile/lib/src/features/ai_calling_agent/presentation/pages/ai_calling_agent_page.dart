import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../account/presentation/widgets/account_required_panel.dart';
import '../../../compliance/data/voice_processing_consent_store.dart';
import '../../../compliance/presentation/widgets/voice_processing_consent_dialog.dart';
import '../../data/ai_calling_agent_api_client.dart';
import '../ai_calling_agent_policy.dart';
import '../widgets/ai_calling_agent_draft_panel.dart';
import '../widgets/ai_calling_agent_form.dart';
import '../widgets/ai_calling_agent_intro.dart';
import '../widgets/ai_calling_agent_stage_bar.dart';
import '../widgets/ai_calling_agent_task_list.dart';
import 'agent_call_takeover_page.dart';

const _consentPromptVersion = 'domestic-ai-agent-consent-v1';
const _disclosurePromptVersion = 'domestic-ai-agent-disclosure-v1';

class AiCallingAgentPage extends StatefulWidget {
  const AiCallingAgentPage({
    this.client,
    this.voiceConsentStore,
    super.key,
  });

  final AiCallingAgentApiClient? client;
  final VoiceProcessingConsentStore? voiceConsentStore;

  @override
  State<AiCallingAgentPage> createState() => _AiCallingAgentPageState();
}

class _AiCallingAgentPageState extends State<AiCallingAgentPage> {
  late final AiCallingAgentApiClient _client = widget.client ??
      AiCallingAgentApiClient(baseUrl: AppConfig.fromEnvironment().apiBaseUrl);
  late final bool _ownsClient = widget.client == null;
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
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadDrafts());
  }

  @override
  void dispose() {
    _targetNameController.dispose();
    _targetPhoneController.dispose();
    _objectiveController.dispose();
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
              AiCallingAgentDraftPanel(
                key: _draftPanelKey,
                draft: _draft!,
                busy: _loading,
                onAuthorize: _authorizeDraft,
                onStart: _startDraft,
                onRefresh: _refreshDraft,
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

  Future<void> _createDraft() async {
    final objective = _objectiveController.text.trim();
    final targetPhone = _targetPhoneController.text.trim();
    if (objective.isEmpty) {
      setState(() => _error = '请先填写本次电话目标');
      return;
    }
    if (targetPhone.isNotEmpty && !isValidAgentCallPhone(targetPhone)) {
      setState(() => _error = '请输入有效电话号码');
      return;
    }
    await _run(() async {
      final draft = await _client.createDraft(
        scenario: _scenario,
        objective: objective,
        targetName: _targetNameController.text.trim(),
        targetPhone: targetPhone,
      );
      _setDraft(draft);
      _notice =
          draft.requiresHumanTakeover ? '已识别高风险内容，请人工接管。' : '话术草稿已生成，请确认授权。';
    });
  }

  Future<void> _authorizeDraft() async {
    final draft = _draft;
    if (draft == null) return;
    if (!await _ensureVoiceConsent()) return;
    if (!_recipientDisclosureConfirmed) {
      setState(() => _error = '请先确认接通后向对方告知 AI 身份');
      return;
    }
    if (!mounted) return;
    await _run(() async {
      final next = await _client.authorizeDraft(
        draftId: draft.id,
        consentPromptVersion: _consentPromptVersion,
        recipientDisclosureConfirmed: true,
        disclosurePromptVersion: _disclosurePromptVersion,
      );
      _setDraft(next);
      _notice =
          next.requiresHumanTakeover ? '风险内容需要人工接管，暂不自动外呼。' : '已授权，可开始执行。';
    });
  }

  Future<void> _startDraft() async {
    final draft = _draft;
    if (draft == null) return;
    if (!await _ensureVoiceConsent()) return;
    if (!mounted) return;
    await _run(() async {
      _setDraft(await _client.startDraft(
        draftId: draft.id,
        consentPromptVersion: _consentPromptVersion,
      ));
      _notice = '已进入执行队列，可刷新查看进度。';
    });
  }

  Future<void> _refreshDraft() async {
    final draft = _draft;
    if (draft == null) return;
    await _run(() async {
      _setDraft(await _client.getDraft(draftId: draft.id));
      _notice = '状态已刷新。';
    });
  }

  Future<void> _requestTakeover() async {
    final draft = _draft;
    if (draft == null || !await _ensureVoiceConsent()) return;
    if (draft.status != 'takeover_requested') {
      await _run(() async {
        _setDraft(await _client.requestTakeover(
          draftId: draft.id,
          reason: 'user_requested_takeover',
        ));
        _notice = '已记录人工接管请求。';
      });
    }
    final current = _draft;
    final takeoverCallId = current?.callId;
    if (!mounted ||
        current == null ||
        takeoverCallId == null ||
        current.status != 'takeover_requested') {
      return;
    }
    final takeover = current;
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => AgentCallTakeoverPage(
        draftId: takeover.id,
        callId: takeoverCallId,
        takeoverReadyAt: takeover.takeoverReadyAt,
      ),
    ));
    if (mounted) await _refreshDraft();
  }

  Future<void> _cancelDraft() async {
    final draft = _draft;
    if (draft == null) return;
    await _run(() async {
      _setDraft(await _client.cancelDraft(draftId: draft.id));
      _notice = '已取消任务，未发起拨号。';
    });
  }

  Future<void> _loadDrafts() async {
    if (_draftsLoading) return;
    setState(() {
      _draftsLoading = true;
      _draftsError = null;
    });
    try {
      final drafts = await _client.listDrafts();
      if (!mounted) return;
      setState(() => _drafts = drafts);
    } catch (error) {
      if (!mounted) return;
      setState(() => _draftsError = error);
    } finally {
      if (mounted) setState(() => _draftsLoading = false);
    }
  }

  void _selectDraft(AiCallingAgentDraft draft) {
    setState(() {
      _draft = draft;
      _error = null;
      _notice = '已打开任务。';
    });
    _scrollToDraft();
  }

  void _setDraft(AiCallingAgentDraft draft) {
    _draft = draft;
    _drafts = <AiCallingAgentDraft>[
      draft,
      ..._drafts.where((item) => item.id != draft.id),
    ];
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
