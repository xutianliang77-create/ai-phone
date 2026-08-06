import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../platform/translation/supported_translation_language.dart';
import '../../../call_link/data/call_link_api_client.dart';
import '../../../call_link/data/call_room_client.dart';
import '../../../call_link/data/livekit_call_room_client.dart';
import '../../../call_link/presentation/widgets/call_room_captions.dart';
import '../../../compliance/data/voice_processing_consent_store.dart';
import '../../../compliance/presentation/widgets/voice_processing_consent_dialog.dart';
import '../../data/pstn_call_readiness_client.dart';
import '../../data/pstn_call_session.dart';
import '../widgets/pstn_call_widgets.dart';
import '../widgets/pstn_call_control_panel.dart';

class PstnCallPage extends StatefulWidget {
  const PstnCallPage({
    required this.config,
    this.readinessFetcher = fetchPstnCallReadiness,
    this.apiClient,
    this.roomClient,
    this.voiceConsentStore,
    super.key,
  });

  final AppConfig config;
  final PstnCallReadinessFetcher readinessFetcher;
  final CallLinkApiClient? apiClient;
  final CallRoomClient? roomClient;
  final VoiceProcessingConsentStore? voiceConsentStore;

  @override
  State<PstnCallPage> createState() => _PstnCallPageState();
}

class _PstnCallPageState extends State<PstnCallPage> {
  late final CallLinkApiClient _apiClient =
      widget.apiClient ?? CallLinkApiClient(baseUrl: widget.config.apiBaseUrl);
  late final CallRoomClient _roomClient =
      widget.roomClient ?? LiveKitCallRoomClient();
  late final PstnCallSession _session = PstnCallSession(
    apiClient: _apiClient,
    roomClient: _roomClient,
  );
  late final VoiceProcessingConsentStore _voiceConsentStore =
      widget.voiceConsentStore ?? const FileVoiceProcessingConsentStore();
  final _formKey = GlobalKey<FormState>();
  final _phoneController = TextEditingController();
  StreamSubscription<CallRoomSnapshot>? _roomSubscription;
  String _hostLanguage = 'zh';
  String _calleeLanguage = 'en';
  bool _disclosureConfirmed = false;
  bool _loading = false;
  bool _reviewed = false;
  String? _normalizedPhone;
  Object? _readinessError;
  PstnCallReadiness? _readiness;
  SipOutboundCall? _sipCall;
  CallLinkEndResult? _endResult;
  CallRoomSnapshot _roomSnapshot = const CallRoomSnapshot.disconnected();
  Object? _callError;
  bool _callBusy = false;

  bool get _isChinese => Localizations.localeOf(context).languageCode == 'zh';

  @override
  void initState() {
    super.initState();
    _roomSubscription = _roomClient.snapshots.listen((snapshot) {
      if (mounted) setState(() => _roomSnapshot = snapshot);
    });
    if (widget.config.region.isPstnEnabled) {
      _loadReadiness();
    }
  }

  @override
  void dispose() {
    _phoneController.dispose();
    unawaited(_roomSubscription?.cancel());
    unawaited(_session.dispose(
      ownsApiClient: widget.apiClient == null,
      ownsRoomClient: widget.roomClient == null,
    ));
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(_text('拨打手机号', 'Dial phone number'))),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
            children: <Widget>[
              Text(
                _text('直接拨号翻译', 'Translated phone call'),
                style: theme.textTheme.headlineSmall,
              ),
              const SizedBox(height: 6),
              Text(
                _text(
                  '你在 App 内说话，对方接听普通电话；字幕、译音和用量会同步记录。',
                  'Speak in the app while the other person answers a regular phone call. Captions, translated audio, and usage stay in sync.',
                ),
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 16),
              PstnCallAvailabilityCard(
                policyEnabled: widget.config.region.isPstnEnabled,
                loading: _loading,
                readiness: _readiness,
                error: _readinessError,
                chinese: _isChinese,
                onRetry: _loadReadiness,
              ),
              const SizedBox(height: 20),
              TextFormField(
                key: const Key('pstn-phone-field'),
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.next,
                autofillHints: const <String>[AutofillHints.telephoneNumber],
                decoration: InputDecoration(
                  labelText: _text('对方号码', 'Phone number'),
                  hintText: widget.config.region.defaultCountry == 'CN'
                      ? '+86 138 0013 8000'
                      : '+1 415 555 0198',
                  helperText: _text(
                    '国际号码请包含国家/地区码',
                    'Include the country or region code',
                  ),
                  prefixIcon: const Icon(Icons.phone_outlined),
                ),
                validator: _validatePhone,
                onChanged: (_) => _clearReview(),
              ),
              const SizedBox(height: 16),
              PstnCallLanguageField(
                label: _text('我的语言', 'My language'),
                value: _hostLanguage,
                chinese: _isChinese,
                onChanged: (value) => setState(() {
                  _hostLanguage = value;
                  _reviewed = false;
                }),
              ),
              const SizedBox(height: 12),
              PstnCallLanguageField(
                label: _text('对方语言', 'Other person\'s language'),
                value: _calleeLanguage,
                chinese: _isChinese,
                onChanged: (value) => setState(() {
                  _calleeLanguage = value;
                  _reviewed = false;
                }),
              ),
              const SizedBox(height: 16),
              Card(
                margin: EdgeInsets.zero,
                child: ListTile(
                  leading: const Icon(Icons.payments_outlined),
                  title: Text(_text('费用预估', 'Estimated cost')),
                  subtitle: Text(_text(
                    '约 2–5 credits / 分钟，以接通后实际用量结算',
                    'About 2–5 credits/minute, billed from answered usage',
                  )),
                ),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: _disclosureConfirmed,
                onChanged: (value) => setState(() {
                  _disclosureConfirmed = value ?? false;
                  _reviewed = false;
                }),
                title: Text(_text(
                  '我同意接通后告知对方正在进行 AI 翻译和转写',
                  'I agree to disclose AI translation and transcription after connection',
                )),
                subtitle: Text(_text(
                  '对方拒绝后必须立即结束，不得自动重拨。',
                  'If declined, the call must end immediately without automatic redial.',
                )),
                controlAffinity: ListTileControlAffinity.leading,
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _review,
                  icon: const Icon(Icons.fact_check_outlined),
                  label: Text(_text('检查拨号信息', 'Review call details')),
                ),
              ),
              if (_reviewed) ...<Widget>[
                const SizedBox(height: 16),
                PstnCallReviewCard(
                  phone: _normalizedPhone!,
                  hostLanguage: _languageName(_hostLanguage),
                  calleeLanguage: _languageName(_calleeLanguage),
                  canDial: _readiness?.isReady == true,
                  chinese: _isChinese,
                  busy: _callBusy,
                  onDial: _startCall,
                ),
              ],
              if (_sipCall != null) ...<Widget>[
                PstnCallControlPanel(
                  session: _session,
                  call: _sipCall!,
                  roomSnapshot: _roomSnapshot,
                  endBusy: _callBusy,
                  chinese: _isChinese,
                  onEnd: _endCall,
                  defaultCountry: widget.config.region.defaultCountry,
                  endResult: _endResult,
                  error: _callError,
                ),
                CallRoomCaptions(
                  captions: _roomSnapshot.captions,
                  localRole: 'host',
                ),
              ] else if (_callError != null) ...<Widget>[
                const SizedBox(height: 12),
                Text(
                  _callError.toString(),
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String? _validatePhone(String? value) {
    final phone = _normalizePhone(value ?? '');
    if (!RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(phone)) {
      return _text(
          '请输入有效的手机号和国家/地区码', 'Enter a valid number with country code');
    }
    return null;
  }

  String _normalizePhone(String value) {
    var phone = value.replaceAll(RegExp(r'[^\d+]'), '');
    if (!phone.startsWith('+') &&
        widget.config.region.defaultCountry == 'CN' &&
        RegExp(r'^1[3-9]\d{9}$').hasMatch(phone)) {
      phone = '+86$phone';
    }
    return phone;
  }

  void _review() {
    if (!_formKey.currentState!.validate()) return;
    if (_hostLanguage == _calleeLanguage) {
      _showMessage(_text('请选择不同的我方和对方语言', 'Choose two different languages'));
      return;
    }
    if (!_disclosureConfirmed) {
      _showMessage(_text('请先确认通话告知规则', 'Confirm the call disclosure first'));
      return;
    }
    setState(() {
      _normalizedPhone = _normalizePhone(_phoneController.text);
      _reviewed = true;
    });
  }

  Future<void> _loadReadiness() async {
    if (_loading || !widget.config.region.isPstnEnabled) return;
    setState(() {
      _loading = true;
      _readiness = null;
      _readinessError = null;
    });
    try {
      final readiness = await widget.readinessFetcher(widget.config.apiBaseUrl);
      if (mounted) setState(() => _readiness = readiness);
    } on Object catch (error) {
      if (mounted) setState(() => _readinessError = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _startCall() async {
    if (_callBusy || _sipCall != null || _normalizedPhone == null) return;
    final consent = await ensureVoiceProcessingConsent(
      context: context,
      store: _voiceConsentStore,
      scene: VoiceProcessingConsentScene.callLink,
    );
    if (!consent || !mounted) return;
    setState(() {
      _callBusy = true;
      _callError = null;
      _endResult = null;
    });
    try {
      final call = await _session.start(
        targetPhone: _normalizedPhone!,
        sourceLanguage: _hostLanguage,
        targetLanguage: _calleeLanguage,
        provider: _readiness?.provider ?? 'livekit_sip',
      );
      if (mounted) setState(() => _sipCall = call);
    } on Object catch (error) {
      if (mounted) setState(() => _callError = error);
    } finally {
      if (mounted) setState(() => _callBusy = false);
    }
  }

  Future<void> _endCall() async {
    if (_callBusy || _session.link == null) return;
    setState(() {
      _callBusy = true;
      _callError = null;
    });
    try {
      final result = await _session.end();
      if (mounted) setState(() => _endResult = result);
    } on Object catch (error) {
      if (mounted) setState(() => _callError = error);
    } finally {
      if (mounted) setState(() => _callBusy = false);
    }
  }

  void _clearReview() {
    if (_reviewed) setState(() => _reviewed = false);
  }

  void _showMessage(String message) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(message)));
  String _languageName(String code) =>
      translationLanguageName(code, chinese: _isChinese);
  String _text(String chinese, String english) =>
      _isChinese ? chinese : english;
}
