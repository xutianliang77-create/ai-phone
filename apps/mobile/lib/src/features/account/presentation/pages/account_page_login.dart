part of 'account_page.dart';

extension _AccountPageLogin on _AccountPageState {
  Widget _buildLoginForm() {
    if (_client.deploymentId.isNotEmpty) {
      return FilledButton.icon(
        onPressed: _loading ? null : _loginApple,
        icon: const Icon(Icons.apple),
        label: const Text('通过 Apple 登录'),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        TextField(
          controller: _phoneController,
          decoration: const InputDecoration(labelText: '手机号'),
          keyboardType: TextInputType.phone,
          textInputAction: TextInputAction.next,
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _codeController,
          decoration: const InputDecoration(labelText: '验证码'),
          keyboardType: TextInputType.number,
          textInputAction: TextInputAction.done,
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 12,
          runSpacing: 8,
          children: <Widget>[
            OutlinedButton.icon(
              onPressed: _loading ? null : _requestCode,
              icon: const Icon(Icons.sms_outlined),
              label: const Text('获取验证码'),
            ),
            FilledButton.icon(
              onPressed: _loading ? null : _login,
              icon: const Icon(Icons.login),
              label: const Text('登录'),
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _requestCode() async {
    final phone = _phoneController.text.trim();
    await _run(() async {
      final challenge = await _client.requestPhoneCode(phone);
      _message = challenge.debugCode == null
          ? '验证码已发送至 ${challenge.phoneMasked}'
          : '开发验证码：${challenge.debugCode}';
    });
  }

  Future<void> _login() async {
    final phone = _phoneController.text.trim();
    final code = _codeController.text.trim();
    await _run(() async {
      final result = await _client.loginWithPhoneCode(phone: phone, code: code);
      final session = _client.sessionFromLogin(result);
      await _sessionStore.save(session);
      _session = session;
      _account = result.account;
      _message = '登录成功';
    });
  }

  Future<void> _loginApple() async {
    final accepted = await confirmAppleAgreements(context);
    if (accepted != true || !mounted) return;
    await _run(() async {
      final challenge = await _client.appleChallenge();
      final login = await _client.loginWithApple(
        challenge,
        privacyAccepted: true,
        termsAccepted: true,
        identity: widget.appleIdentity ?? const AppleIdentityClient(),
      );
      final session = _client.sessionFromLogin(login);
      await _sessionStore.save(session);
      _session = session;
      _account = login.account;
      _message = '登录成功';
    });
  }
}
