import 'package:flutter/material.dart';

class AiCallingAgentIntro extends StatelessWidget {
  const AiCallingAgentIntro({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Text(
      '授权后才进入拨号队列，高风险任务转人工处理。',
      style: theme.textTheme.bodyMedium?.copyWith(
        color: theme.colorScheme.onSurfaceVariant,
      ),
    );
  }
}
