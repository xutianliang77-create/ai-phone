import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../../../account/data/account_api_client.dart'
    show verifyAccountDeployment;
import '../../../account/data/account_session_store.dart';
import '../../../../platform/diagnostics/control_diagnostic_policy.dart';
import '../../../../platform/http/public_http_client.dart';

/// Public identity only: no account, Apple refresh, license or receipt operation.
Future<Map<String, Object?>> runPublicControlDiagnostic({
  http.Client? client,
}) async {
  if (!controlDiagnosticReadOnly) {
    throw StateError('control_diagnostic_disabled');
  }
  final base = Uri.parse(configuredAccountApiBaseUrl);
  requireAccountOrigin(base, configuredPublicDeploymentId);
  final transport = client ?? createPublicHttpClient(base);
  try {
    await verifyAccountDeployment(
      transport,
      base,
      configuredPublicDeploymentId,
      const Duration(seconds: 30),
      forceRefresh: true,
    );
    return {'identityVerified': true};
  } finally {
    if (client == null) transport.close();
  }
}

/// Only exposed by the explicitly read-only QA build.
class ControlDiagnosticPage extends StatefulWidget {
  const ControlDiagnosticPage({this.probe, super.key});
  final Future<Map<String, Object?>> Function()? probe;

  @override
  State<ControlDiagnosticPage> createState() => _ControlDiagnosticPageState();
}

class _ControlDiagnosticPageState extends State<ControlDiagnosticPage> {
  bool _busy = false;
  String _state = '准备就绪；点击后只检查公开服务身份，不领取授权。';

  Future<void> _run() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _state = '正在检查连接…';
    });
    try {
      final result = await (widget.probe ?? runPublicControlDiagnostic)();
      if (!mounted) return;
      setState(() {
        _state = result['identityVerified'] == true
            ? '服务身份已验证；未领取授权。'
            : '服务已响应，请保留结果供核对。';
      });
    } catch (_) {
      if (mounted) setState(() => _state = '连接检查未完成，请保留页面。');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('授权连接诊断')),
    body: Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_state),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy ? null : _run,
            child: const Text('检查一次'),
          ),
        ],
      ),
    ),
  );
}
