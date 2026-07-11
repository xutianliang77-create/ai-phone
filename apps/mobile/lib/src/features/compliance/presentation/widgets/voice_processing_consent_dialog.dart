import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/consent_audit_uploader.dart';
import '../../data/voice_processing_consent_store.dart';

enum VoiceProcessingConsentScene {
  realtimeOnline,
  callLink,
  aiCallingAgent,
}

Future<bool> ensureVoiceProcessingConsent({
  required BuildContext context,
  required VoiceProcessingConsentStore store,
  required VoiceProcessingConsentScene scene,
  ConsentAuditUploader? consentAuditUploader,
}) async {
  final record = await store.load();
  if (record?.version == voiceProcessingConsentVersion) return true;
  if (!context.mounted) return false;
  final locale = Localizations.localeOf(context);

  final accepted = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (context) => _VoiceProcessingConsentDialog(scene: scene),
      ) ??
      false;
  if (!accepted) return false;
  await store.accept(voiceProcessingConsentVersion);
  if (!context.mounted) return true;
  final saved = await store.load();
  unawaited(
    (consentAuditUploader ?? AccountConsentAuditUploader.fromEnvironment())
        .record(
      consentType: 'voice_processing',
      version: voiceProcessingConsentVersion,
      scene: _sceneCode(scene),
      acceptedAtIso: saved?.acceptedAtIso,
      locale: locale,
    ),
  );
  return true;
}

String _sceneCode(VoiceProcessingConsentScene scene) {
  return switch (scene) {
    VoiceProcessingConsentScene.realtimeOnline => 'realtime_online',
    VoiceProcessingConsentScene.callLink => 'call_link',
    VoiceProcessingConsentScene.aiCallingAgent => 'ai_calling_agent',
  };
}

class _VoiceProcessingConsentDialog extends StatefulWidget {
  const _VoiceProcessingConsentDialog({required this.scene});

  final VoiceProcessingConsentScene scene;

  @override
  State<_VoiceProcessingConsentDialog> createState() =>
      _VoiceProcessingConsentDialogState();
}

class _VoiceProcessingConsentDialogState
    extends State<_VoiceProcessingConsentDialog> {
  bool _checked = false;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AlertDialog(
      title: Text(_title(l10n)),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(_body(l10n, widget.scene)),
            const SizedBox(height: 12),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _checked,
              onChanged: (value) => setState(() => _checked = value ?? false),
              title: Text(_checkboxText(l10n)),
              controlAffinity: ListTileControlAffinity.leading,
            ),
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          onPressed: _checked ? () => Navigator.of(context).pop(true) : null,
          child: Text(l10n.isChinese ? '同意并继续' : 'Agree and continue'),
        ),
      ],
    );
  }

  String _title(AppLocalizations l10n) {
    return l10n.isChinese ? '语音敏感信息处理确认' : 'Voice Data Processing Consent';
  }

  String _body(AppLocalizations l10n, VoiceProcessingConsentScene scene) {
    if (!l10n.isChinese) {
      return '${_sceneName(l10n, scene)} may upload microphone audio, '
          'captions, translated text, and synthesized speech to cloud '
          'model services for this session. You can stop at any time, and '
          'saved records can be reviewed or deleted.';
    }
    return '使用${_sceneName(l10n, scene)}时，App 可能会将麦克风音频、字幕、'
        '译文和合成语音发送到云端模型服务，用于本次转写、翻译、朗读、记录和用量结算。'
        '你可以随时暂停或结束，会话记录可在记录/合规中心查看或删除。';
  }

  String _checkboxText(AppLocalizations l10n) {
    return l10n.isChinese
        ? '我同意本次使用云端语音转写、翻译和语音播放能力'
        : 'I agree to use cloud speech, translation, and playback features.';
  }

  String _sceneName(AppLocalizations l10n, VoiceProcessingConsentScene scene) {
    if (!l10n.isChinese) {
      return switch (scene) {
        VoiceProcessingConsentScene.realtimeOnline => 'Online interpreting',
        VoiceProcessingConsentScene.callLink => 'Call Link',
        VoiceProcessingConsentScene.aiCallingAgent => 'AI Calling Agent',
      };
    }
    return switch (scene) {
      VoiceProcessingConsentScene.realtimeOnline => '在线同传',
      VoiceProcessingConsentScene.callLink => '通话链接',
      VoiceProcessingConsentScene.aiCallingAgent => 'AI 代打电话',
    };
  }
}
