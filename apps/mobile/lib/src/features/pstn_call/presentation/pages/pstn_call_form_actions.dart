part of 'pstn_call_page.dart';

extension _PstnCallFormActions on _PstnCallPageState {
  String? _validatePhone(String? value) {
    final phone = _normalizePhone(value ?? '');
    if (!RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(phone)) {
      return _text(
        '请输入有效的手机号和国家/地区码',
        'Enter a valid number with country code',
      );
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
      _showMessage(
        _text('请选择不同的我方和对方语言', 'Choose two different languages'),
      );
      return;
    }
    if (!_disclosureConfirmed) {
      _showMessage(_text('请先确认通话告知规则', 'Confirm the call disclosure first'));
      return;
    }
    _updateState(() {
      _normalizedPhone = _normalizePhone(_phoneController.text);
      _reviewed = true;
    });
  }

  void _clearReview() {
    if (_reviewed) _updateState(() => _reviewed = false);
  }

  void _showMessage(String message) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(message)));

  String _languageName(String code) =>
      translationLanguageName(code, chinese: _isChinese);

  String _text(String chinese, String english) =>
      _isChinese ? chinese : english;
}
