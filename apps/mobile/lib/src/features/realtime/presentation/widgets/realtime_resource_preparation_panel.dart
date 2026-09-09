import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../controllers/realtime_controller.dart';
import '../controllers/realtime_local_resource.dart';
import '../realtime_settings_l10n.dart';

/// Part of the original settings sheet; no providers/controllers are created here.
class RealtimeResourcePreparationPanel extends StatelessWidget {
  const RealtimeResourcePreparationPanel({required this.controller, super.key});
  final RealtimeController controller;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final zh = context.l10n.isChinese;
        final busy = controller.resourceOperationRunning;
        return Card(
            child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                        zh
                            ? '本地 ASR/VAD、翻译与声音资源'
                            : 'Local ASR/VAD, translation and voice resources',
                        style: Theme.of(context).textTheme.titleSmall),
                    Text(zh
                        ? '就绪仅表示资源检查通过；质量、自动语言和系统声音仍需单独核验。'
                        : 'Ready means resource checks passed, not quality, automatic-language or system-voice qualification.'),
                    if (controller.localResources.isEmpty)
                      Text(zh
                          ? '尚未检查。按当前语言选择检查，不会自动下载。'
                          : 'Not checked. Check the selected languages without downloading.'),
                    for (final item in controller.localResources)
                      _row(context, item),
                    Wrap(spacing: 8, children: [
                      TextButton.icon(
                          key: const ValueKey('check-local-resources'),
                          onPressed: controller.canCheckLocalResources
                              ? controller.checkLocalResources
                              : null,
                          icon: const Icon(Icons.refresh),
                          label: Text(zh ? '检查资源' : 'Check resources')),
                      if (busy)
                        TextButton(
                            key: const ValueKey('cancel-local-resources'),
                            onPressed:
                                controller.cancelLocalResourcePreparation,
                            child: Text(zh ? '取消准备' : 'Cancel preparation')),
                    ]),
                    if (busy) const LinearProgressIndicator(),
                    if (!busy && !controller.canCheckLocalResources)
                      Text(zh
                          ? '需结束当前会话，并使用已选 iOS 本地系统链。在线模式无需准备本地资源。'
                          : 'End the session and use the selected iOS local system chain. Online mode does not require local resources.'),
                  ],
                )));
      });

  Widget _row(BuildContext context, RealtimeLocalResource item) {
    final l10n = context.l10n, zh = l10n.isChinese;
    final kind = switch (item.kind) {
      LocalResourceKind.asr => 'ASR / VAD',
      LocalResourceKind.translation => zh ? '翻译' : 'Translation',
      LocalResourceKind.speech => zh ? '系统声音' : 'System voice',
    };
    final pair = '${l10n.languageDisplayName(item.sourceLanguage)}'
        '${item.targetLanguage == null ? "" : " → ${l10n.languageDisplayName(item.targetLanguage!)}"}';
    final phase = switch (item.phase) {
      LocalResourcePhase.unchecked => zh ? '未检查' : 'Not checked',
      LocalResourcePhase.checking => zh ? '检查中' : 'Checking',
      LocalResourcePhase.missing => zh ? '未安装' : 'Not installed',
      LocalResourcePhase.ready => item.kind == LocalResourceKind.speech
          ? (zh ? '设备可用，断网待验' : 'Available on device; offline test pending')
          : (zh ? '资源已就绪' : 'Resources ready'),
      LocalResourcePhase.unsupported => zh ? '暂不支持' : 'Not supported',
      LocalResourcePhase.preparing => zh ? '准备中' : 'Preparing',
      LocalResourcePhase.failed => zh ? '尚未就绪' : 'Not ready',
      LocalResourcePhase.cancelled => zh ? '已停止本次准备' : 'Preparation stopped',
    };
    return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('$kind · $pair · $phase',
                key: ValueKey('resource-${item.id}')),
            if (item.voice != null) ...[
              Text(
                  '${item.voice!.name} · ${item.voice!.language} · ${zh ? "系统质量等级" : "System quality tier"} ${item.voice!.quality}'),
              SelectableText(item.voice!.identifier),
            ],
            if (item.reason.isNotEmpty && item.reason != 'ready')
              Text(_reason(item.reason, zh)),
            if (item.canPrepare)
              Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                      key: ValueKey('prepare-resource-${item.id}'),
                      onPressed: controller.canCheckLocalResources
                          ? () => _prepare(context, item)
                          : null,
                      child:
                          Text(zh ? '准备所选资源' : 'Prepare selected resources'))),
          ],
        ));
  }

  Future<void> _prepare(
      BuildContext context, RealtimeLocalResource item) async {
    final l10n = context.l10n, zh = l10n.isChinese;
    final label = '${l10n.languageDisplayName(item.sourceLanguage)}'
        '${item.targetLanguage == null ? "" : " → ${l10n.languageDisplayName(item.targetLanguage!)}"}';
    final accepted = await showDialog<bool>(
        context: context,
        builder: (dialog) => AlertDialog(
              title: Text(zh
                  ? '准备 $label 的本地资源？'
                  : 'Prepare local resources for $label?'),
              content: Text(zh
                  ? '此操作可能联网下载并占用存储，大小由系统决定。不上传会话音频或文本，不自动开始识别、翻译或朗读。系统可能另行请求下载许可。'
                  : 'This may download resources and use storage; the system determines their size. No session audio or text is uploaded, and recognition, translation and speech will not start. A system download prompt may follow.'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialog, false),
                    child: Text(zh ? '取消' : 'Cancel')),
                FilledButton(
                    key: const ValueKey('confirm-resource-download'),
                    onPressed: () => Navigator.pop(dialog, true),
                    child: Text(zh ? '允许准备' : 'Allow preparation'))
              ],
            ));
    if (accepted == true && context.mounted) {
      await controller.prepareLocalResource(item.id, downloadAuthorized: true);
    }
  }

  String _reason(String reason, bool zh) => switch (reason) {
        'language_resource_downloading' => zh
            ? '系统正在下载或等待下载条件，请稍后重新检查；不会重复发起下载。'
            : 'The system is downloading or waiting for download conditions. Recheck later; no duplicate download is started.',
        'language_resource_not_ready' => zh
            ? '系统列出了该语言资源，但当前ASR配置尚未就绪；可明确准备后重新检查，不会自动下载。'
            : 'The locale is listed as installed, but this ASR configuration is not ready. Explicit preparation can recheck it; no automatic download.',
        'resource_state_unknown' => zh
            ? '系统返回了未知资源状态，不能开始或自动准备，请保留诊断信息。'
            : 'The system returned an unknown resource state. Start and automatic preparation are blocked; retain diagnostics.',
        'voice_available_on_device' => zh
            ? '本地自然声音使用此系统声线；在线音色偏好保留，不当作本机Voice ID。断网与听感尚未实测。'
            : 'Local Natural uses this system voice. Online presets are retained, not reused as device IDs. Offline listening is not verified.',
        'speech_voice_unavailable' => zh
            ? '当前语言没有符合映射规则的可用系统声音。请在iOS系统设置中下载所需声音后重新检查；本App不会自动下载或改用其他语言。'
            : 'No eligible system voice matches this language. Download the voice in iOS settings, then recheck; no automatic download or language fallback.',
        'speech_voice_metadata_invalid' ||
        'speech_voice_diagnostics_unavailable' ||
        'ios_voice_inspection_unavailable' =>
          zh
              ? '系统声音信息未取得或不匹配，不能认定离线可用。'
              : 'System voice metadata is unavailable or mismatched; offline readiness is not established.',
        'languageResourceMissing' ||
        'language_resource_missing' ||
        'language_pair_not_installed' =>
          zh
              ? '所选语言资源未安装；准备后会重新检查。'
              : 'Selected resources are missing; readiness will be checked again after preparation.',
        'fixed_language_pair_required' || 'automaticLanguageNotQualified' => zh
            ? '请明确语言对；自动语言资格尚未完成，不会猜测语言或改成中英。'
            : 'Choose an explicit language pair. Automatic language is not qualified; no language is guessed.',
        'resource_storage_full' => zh
            ? '系统报告存储空间不足；不会删除现有资源。'
            : 'The system reported insufficient storage. No existing resources will be removed.',
        'resource_network_unavailable' => zh
            ? '网络下载失败；恢复网络后可重新准备。'
            : 'The network download failed. Retry after connectivity is restored.',
        'resource_preparation_cancelled' => zh
            ? '本次等待已取消；系统共享下载可能继续，请重新检查资源。'
            : 'This wait was cancelled. Shared system downloads may continue; check resources again.',
        'resource_preparation_timeout' ||
        'resource_preparation_not_ready' ||
        'resource_preparation_busy' =>
          zh
              ? '系统尚未确认准备完成，请稍后重新检查。'
              : 'The system has not confirmed readiness. Check again later.',
        'sileroMissing' || 'sileroCorrupt' => zh
            ? 'VAD资源缺失或校验失败，需修复安装包；不会静默替换模型。'
            : 'VAD is missing or corrupt. Repair the app package; the model is not silently replaced.',
        'permission_denied' => zh
            ? '请在系统设置允许语音/麦克风权限，再重新检查。'
            : 'Allow speech/microphone permission in system settings and check again.',
        'resource_ui_unavailable' => zh
            ? '请回到前台正常页面后再准备。'
            : 'Return to the foreground app before preparing resources.',
        _ => '${zh ? "检查未通过" : "Check did not pass"}: $reason',
      };
}
