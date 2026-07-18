import 'package:flutter/material.dart';

enum EnterpriseMobileStatus { loading, empty, notReady, forbidden, failed }

class EnterpriseMobileStatusPanel extends StatelessWidget {
  const EnterpriseMobileStatusPanel({
    required this.status,
    required this.description,
    this.title,
    this.traceId,
    this.action,
    super.key,
  });

  final EnterpriseMobileStatus status;
  final String? title;
  final String description;
  final String? traceId;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final presentation = _presentation(status);
    return Semantics(
      liveRegion: status != EnterpriseMobileStatus.empty,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(presentation.icon, color: presentation.color(context)),
              const SizedBox(height: 14),
              Text(
                title ?? presentation.title,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 6),
              Text(description),
              if (traceId != null) ...<Widget>[
                const SizedBox(height: 8),
                SelectableText(
                  '追踪编号 $traceId',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
              if (action != null) ...<Widget>[
                const SizedBox(height: 16),
                action!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

_StatusPresentation _presentation(EnterpriseMobileStatus status) {
  return switch (status) {
    EnterpriseMobileStatus.loading => const _StatusPresentation(
        Icons.autorenew,
        '正在加载',
        _primary,
      ),
    EnterpriseMobileStatus.empty => const _StatusPresentation(
        Icons.inbox_outlined,
        '暂无数据',
        _outline,
      ),
    EnterpriseMobileStatus.notReady => const _StatusPresentation(
        Icons.warning_amber_outlined,
        '尚未就绪',
        _error,
      ),
    EnterpriseMobileStatus.forbidden => const _StatusPresentation(
        Icons.lock_outline,
        '无权访问',
        _error,
      ),
    EnterpriseMobileStatus.failed => const _StatusPresentation(
        Icons.error_outline,
        '加载失败',
        _error,
      ),
  };
}

class _StatusPresentation {
  const _StatusPresentation(this.icon, this.title, this.color);

  final IconData icon;
  final String title;
  final Color Function(BuildContext) color;
}

Color _primary(BuildContext context) => Theme.of(context).colorScheme.primary;
Color _outline(BuildContext context) => Theme.of(context).colorScheme.outline;
Color _error(BuildContext context) => Theme.of(context).colorScheme.error;
