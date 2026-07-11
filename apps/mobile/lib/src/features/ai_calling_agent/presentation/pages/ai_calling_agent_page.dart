import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../account/presentation/widgets/account_required_panel.dart';
import '../../../compliance/data/voice_processing_consent_store.dart';
import '../../../compliance/presentation/widgets/voice_processing_consent_dialog.dart';
import '../../data/ai_calling_agent_api_client.dart';
import '../widgets/ai_calling_agent_draft_panel.dart';

const _consentPromptVersion = 'domestic-ai-agent-consent-v1';

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
  String _scenario = 'booking';
  AiCallingAgentDraft? _draft;
  String? _notice;
  Object? _error;
  bool _loading = false;

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
            const Text('先生成话术草稿，用户确认授权后才进入拨号队列。'),
            const SizedBox(height: 4),
            const Text('涉及付款、身份验证、合同、医疗、法律、金融时必须人工接管。'),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _scenario,
              decoration: const InputDecoration(labelText: '场景'),
              items: const <DropdownMenuItem<String>>[
                DropdownMenuItem(value: 'booking', child: Text('预约')),
                DropdownMenuItem(
                    value: 'customer_support', child: Text('客服查询')),
                DropdownMenuItem(
                    value: 'business_inquiry', child: Text('外贸询价')),
                DropdownMenuItem(value: 'custom', child: Text('自定义')),
              ],
              onChanged: _loading
                  ? null
                  : (value) => setState(() => _scenario = value!),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _targetNameController,
              decoration: const InputDecoration(labelText: '联系人或机构'),
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _targetPhoneController,
              decoration: const InputDecoration(labelText: '电话号码'),
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _objectiveController,
              decoration: const InputDecoration(
                labelText: '本次电话目标',
                hintText: '例如：预约明天下午的牙医复诊',
              ),
              maxLines: 3,
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _loading ? null : _createDraft,
              icon: const Icon(Icons.description_outlined),
              label: const Text('生成话术草稿'),
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
                      _errorMessage(_error!),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
            ],
            if (_draft != null) ...[
              const SizedBox(height: 16),
              AiCallingAgentDraftPanel(
                draft: _draft!,
                busy: _loading,
                onAuthorize: _authorizeDraft,
                onStart: _startDraft,
                onRefresh: _refreshDraft,
                onTakeover: _requestTakeover,
                onCancel: _cancelDraft,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _createDraft() async {
    final objective = _objectiveController.text.trim();
    if (objective.isEmpty) {
      setState(() => _error = '请先填写本次电话目标');
      return;
    }
    await _run(() async {
      final draft = await _client.createDraft(
        scenario: _scenario,
        objective: objective,
        targetName: _targetNameController.text.trim(),
        targetPhone: _targetPhoneController.text.trim(),
      );
      _draft = draft;
      _notice =
          draft.requiresHumanTakeover ? '已识别高风险内容，请人工接管。' : '话术草稿已生成，请确认授权。';
    });
  }

  Future<void> _authorizeDraft() async {
    final draft = _draft;
    if (draft == null) return;
    if (!await _ensureVoiceConsent()) return;
    if (!mounted) return;
    await _run(() async {
      final next = await _client.authorizeDraft(
        draftId: draft.id,
        consentPromptVersion: _consentPromptVersion,
      );
      _draft = next;
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
      _draft = await _client.startDraft(
        draftId: draft.id,
        consentPromptVersion: _consentPromptVersion,
      );
      _notice = '已进入执行队列，可刷新查看进度。';
    });
  }

  Future<void> _refreshDraft() async {
    final draft = _draft;
    if (draft == null) return;
    await _run(() async {
      _draft = await _client.getDraft(draftId: draft.id);
      _notice = '状态已刷新。';
    });
  }

  Future<void> _requestTakeover() async {
    final draft = _draft;
    if (draft == null) return;
    await _run(() async {
      _draft = await _client.requestTakeover(
        draftId: draft.id,
        reason: 'user_requested_takeover',
      );
      _notice = '已记录人工接管请求。';
    });
  }

  Future<void> _cancelDraft() async {
    final draft = _draft;
    if (draft == null) return;
    await _run(() async {
      _draft = await _client.cancelDraft(draftId: draft.id);
      _notice = '已取消任务，未发起拨号。';
    });
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
      if (mounted) setState(() => _loading = false);
    }
  }

  String _errorMessage(Object error) {
    final message = error.toString();
    if (message.contains('Create agent draft failed')) {
      return '创建任务失败，请检查 API 服务。';
    }
    if (message.contains('Authorize agent draft failed')) return '授权失败，请稍后重试。';
    if (message.contains('Start agent call failed')) return '拨号执行服务未配置，暂不外呼。';
    if (message.contains('Get agent draft failed')) return '刷新状态失败，请稍后重试。';
    if (message.contains('Request takeover failed')) return '接管请求失败，请稍后重试。';
    if (message.contains('Cancel agent draft failed')) return '取消任务失败，请稍后重试。';
    return message.replaceFirst('Exception: ', '');
  }

  Future<bool> _ensureVoiceConsent() {
    return ensureVoiceProcessingConsent(
      context: context,
      store: _voiceConsentStore,
      scene: VoiceProcessingConsentScene.aiCallingAgent,
    );
  }
}
