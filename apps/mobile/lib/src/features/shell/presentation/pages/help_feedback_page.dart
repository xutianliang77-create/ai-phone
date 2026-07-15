import 'package:flutter/material.dart';

class HelpFeedbackPage extends StatelessWidget {
  const HelpFeedbackPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('帮助与反馈')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: const <Widget>[
            _HelpItem(
              icon: Icons.mic_none,
              title: '同传没有字幕',
              body: '检查麦克风权限和网络状态；在线模式需保持无界 AI 服务可用。',
            ),
            _HelpItem(
              icon: Icons.call_outlined,
              title: '翻译通话没有声音',
              body: '确认双方已进入房间，并检查静音、扬声器和蓝牙音频路由。',
            ),
            _HelpItem(
              icon: Icons.document_scanner_outlined,
              title: '拍照识别不准确',
              body: '保持画面端正、文字清晰，减少反光并尽量完整拍摄文字区域。',
            ),
            _HelpItem(
              icon: Icons.feedback_outlined,
              title: '问题反馈',
              body: '反馈时请附上发生时间、功能页面和复现步骤，避免包含敏感内容。',
            ),
          ],
        ),
      ),
    );
  }
}

class _HelpItem extends StatelessWidget {
  const _HelpItem(
      {required this.icon, required this.title, required this.body});

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(vertical: 8),
      leading: Icon(icon),
      title: Text(title),
      subtitle: Text(body),
    );
  }
}
