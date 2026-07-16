import 'package:flutter/material.dart';

import '../../../../platform/translation/supported_translation_language.dart';
import '../../data/pstn_call_readiness_client.dart';

class PstnCallLanguageField extends StatelessWidget {
  const PstnCallLanguageField({
    required this.label,
    required this.value,
    required this.chinese,
    required this.onChanged,
    super.key,
  });

  final String label;
  final String value;
  final bool chinese;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: supportedHyMtLanguages
          .map((language) => DropdownMenuItem<String>(
                value: language.code,
                child: Text(
                  chinese ? language.chineseName : language.englishName,
                  overflow: TextOverflow.ellipsis,
                ),
              ))
          .toList(growable: false),
      onChanged: (next) {
        if (next != null) onChanged(next);
      },
    );
  }
}

class PstnCallAvailabilityCard extends StatelessWidget {
  const PstnCallAvailabilityCard({
    required this.policyEnabled,
    required this.loading,
    required this.readiness,
    required this.error,
    required this.chinese,
    required this.onRetry,
    super.key,
  });

  final bool policyEnabled;
  final bool loading;
  final PstnCallReadiness? readiness;
  final Object? error;
  final bool chinese;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final ready = readiness?.isReady == true;
    final theme = Theme.of(context);
    return Card(
      color: ready
          ? theme.colorScheme.primaryContainer
          : theme.colorScheme.surfaceContainerHigh,
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(ready
                    ? Icons.check_circle_outline
                    : Icons.science_outlined),
                const SizedBox(width: 10),
                Expanded(
                  child:
                      Text(_title(ready), style: theme.textTheme.titleMedium),
                ),
                if (loading)
                  const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(_body(ready)),
            if (policyEnabled &&
                !loading &&
                (error != null || !ready)) ...<Widget>[
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: Text(_text('重新检查', 'Check again')),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _title(bool ready) {
    if (!policyEnabled) return _text('P2 灰度功能', 'P2 preview');
    if (loading) return _text('正在检查拨号服务', 'Checking calling service');
    return ready
        ? _text('PSTN 链路已就绪', 'PSTN service ready')
        : _text('拨号服务未就绪', 'Calling service unavailable');
  }

  String _body(bool ready) {
    if (!policyEnabled) {
      return _text(
        '当前版本使用 Call Link；直拨入口保留，不会发起真实外呼。',
        'This build uses Call Link. Direct dialing remains visible but cannot place a real call.',
      );
    }
    if (error != null) {
      return _text(
        '无法连接 API 检查服务状态。',
        'Could not reach the API to check service status.',
      );
    }
    return ready
        ? _text(
            '服务商和合规配置已通过，还需完成 App 直拨调度接口。',
            'Provider and compliance checks passed. The app dial orchestration endpoint is still required.',
          )
        : _text(
            '可先完成号码、语言和告知检查，待服务商接入后开放外呼。',
            'Review the number, languages, and disclosure now. Calling opens after provider integration.',
          );
  }

  String _text(String zh, String en) => chinese ? zh : en;
}

class PstnCallReviewCard extends StatelessWidget {
  const PstnCallReviewCard({
    required this.phone,
    required this.hostLanguage,
    required this.calleeLanguage,
    required this.canDial,
    required this.chinese,
    super.key,
  });

  final String phone;
  final String hostLanguage;
  final String calleeLanguage;
  final bool canDial;
  final bool chinese;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              _text('拨号信息已确认', 'Call details reviewed'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            Text('$phone  ·  $hostLanguage → $calleeLanguage'),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: null,
                icon: const Icon(Icons.phone_forwarded_outlined),
                label: Text(canDial
                    ? _text(
                        '直拨调度待接入',
                        'Dial orchestration pending',
                      )
                    : _text(
                        '当前不发起真实外呼',
                        'Real calling is not enabled',
                      )),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _text(String zh, String en) => chinese ? zh : en;
}
