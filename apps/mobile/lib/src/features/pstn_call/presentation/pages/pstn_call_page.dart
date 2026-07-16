import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../platform/translation/supported_translation_language.dart';
import '../../data/pstn_call_readiness_client.dart';
import '../widgets/pstn_call_widgets.dart';

class PstnCallPage extends StatefulWidget {
  const PstnCallPage({
    required this.config,
    this.readinessFetcher = fetchPstnCallReadiness,
    super.key,
  });

  final AppConfig config;
  final PstnCallReadinessFetcher readinessFetcher;

  @override
  State<PstnCallPage> createState() => _PstnCallPageState();
}

class _PstnCallPageState extends State<PstnCallPage> {
  final _formKey = GlobalKey<FormState>();
  final _phoneController = TextEditingController();
  String _hostLanguage = 'zh';
  String _calleeLanguage = 'en';
  bool _disclosureConfirmed = false;
  bool _loading = false;
  bool _reviewed = false;
  String? _normalizedPhone;
  Object? _readinessError;
  PstnCallReadiness? _readiness;

  bool get _isChinese =>
      Localizations.localeOf(context).languageCode.toLowerCase() == 'zh';

  @override
  void initState() {
    super.initState();
    if (widget.config.region.isPstnEnabled) {
      _loadReadiness();
    }
  }

  @override
  void dispose() {
    _phoneController.dispose();
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

  void _clearReview() {
    if (_reviewed) setState(() => _reviewed = false);
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  String _languageName(String code) =>
      translationLanguageName(code, chinese: _isChinese);

  String _text(String chinese, String english) =>
      _isChinese ? chinese : english;
}
