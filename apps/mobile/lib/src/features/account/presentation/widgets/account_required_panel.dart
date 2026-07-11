import 'package:flutter/material.dart';

import '../../data/account_auth_headers.dart';
import '../pages/account_page.dart';

bool isAccountAuthRequiredError(Object? error) {
  if (error is AccountAuthRequiredException) return true;
  final message = error?.toString() ?? '';
  return message.contains('需要先登录账号') ||
      message.contains('auth_required') ||
      message.contains('Account login required');
}

Future<void> openAccountLoginPage(
  BuildContext context, {
  VoidCallback? onReturn,
}) async {
  await Navigator.of(context).push(
    MaterialPageRoute<void>(builder: (_) => const AccountPage()),
  );
  if (!context.mounted) return;
  onReturn?.call();
}

class AccountRequiredPanel extends StatelessWidget {
  const AccountRequiredPanel({
    this.message,
    this.onReturn,
    super.key,
  });

  final String? message;
  final VoidCallback? onReturn;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(Icons.account_circle_outlined, color: colorScheme.primary),
                const SizedBox(width: 8),
                Text(
                  '登录后使用在线服务',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(message ?? '在线同传、通话链接、钱包和 AI 代打电话需要先登录账号。'),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () => openAccountLoginPage(
                context,
                onReturn: onReturn,
              ),
              icon: const Icon(Icons.login),
              label: const Text('去登录'),
            ),
          ],
        ),
      ),
    );
  }
}
