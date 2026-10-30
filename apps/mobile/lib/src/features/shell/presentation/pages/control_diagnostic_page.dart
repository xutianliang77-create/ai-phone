import 'package:flutter/material.dart';

import '../../../../platform/license/on_device_license.dart';

/// Only exposed by the explicitly read-only QA build.
class ControlDiagnosticPage extends StatefulWidget {
  const ControlDiagnosticPage({this.probe, super.key});
  final Future<Map<String, Object?>> Function()? probe;

  @override
  State<ControlDiagnosticPage> createState() => _ControlDiagnosticPageState();
}

class _ControlDiagnosticPageState extends State<ControlDiagnosticPage> {
  bool _busy = false;
  String _state = '准备就绪；点击后只检查授权配置，不领取授权。';

  Future<void> _run() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _state = '正在检查连接…';
    });
    try {
      final result =
          await (widget.probe ??
              () => OnDeviceLicenseClient.shared.request(
                '/v10/device/configuration',
              ))();
      if (!mounted) return;
      setState(() {
        _state = result['licenseAdmission'] == 'closed'
            ? '服务已响应，授权入口当前关闭。'
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
