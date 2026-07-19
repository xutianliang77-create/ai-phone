import 'package:flutter/material.dart';

class AiCallingAgentStageBar extends StatelessWidget {
  const AiCallingAgentStageBar({required this.status, super.key});

  final String? status;

  @override
  Widget build(BuildContext context) {
    final active = switch (status) {
      'authorized' => 1,
      'queued' ||
      'dispatching' ||
      'reconciliation_required' ||
      'in_progress' ||
      'completed' ||
      'failed' ||
      'cancelled' => 2,
      _ => 0,
    };
    return Row(
      children: <Widget>[
        for (var index = 0; index < 3; index++) ...<Widget>[
          Expanded(
            child: Column(
              children: <Widget>[
                Text(
                  const <String>['草稿', '授权', '执行'][index],
                  style: TextStyle(
                    color: index <= active
                        ? Theme.of(context).colorScheme.primary
                        : Theme.of(context).colorScheme.outline,
                    fontWeight: index == active ? FontWeight.w700 : null,
                  ),
                ),
                const SizedBox(height: 8),
                Container(
                  height: 3,
                  color: index <= active
                      ? Theme.of(context).colorScheme.primary
                      : Theme.of(context).colorScheme.outlineVariant,
                ),
              ],
            ),
          ),
          if (index != 2) const SizedBox(width: 4),
        ],
      ],
    );
  }
}
