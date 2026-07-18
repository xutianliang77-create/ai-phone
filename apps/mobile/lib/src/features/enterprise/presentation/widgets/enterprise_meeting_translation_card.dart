import 'package:flutter/material.dart';

import '../../data/enterprise_meeting_room_client.dart';

class EnterpriseMeetingTranslationCard extends StatelessWidget {
  const EnterpriseMeetingTranslationCard({
    required this.snapshot,
    required this.captionLanguage,
    required this.translatedAudioEnabled,
    required this.editable,
    required this.onCaptionLanguage,
    required this.onTranslatedAudio,
    super.key,
  });

  final EnterpriseMeetingRoomSnapshot snapshot;
  final String captionLanguage;
  final bool translatedAudioEnabled;
  final bool editable;
  final ValueChanged<String> onCaptionLanguage;
  final ValueChanged<bool> onTranslatedAudio;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(children: <Widget>[
                Icon(Icons.translate,
                    color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text('实时双语字幕',
                          style: Theme.of(context).textTheme.titleMedium),
                      Text(_translationStatus(snapshot)),
                    ],
                  ),
                ),
              ]),
              const SizedBox(height: 14),
              DropdownButtonFormField<String>(
                initialValue: captionLanguage,
                decoration: const InputDecoration(
                  labelText: '我阅读的字幕语言',
                  prefixIcon: Icon(Icons.closed_caption_outlined),
                ),
                items: const <DropdownMenuItem<String>>[
                  DropdownMenuItem(value: 'zh', child: Text('中文')),
                  DropdownMenuItem(value: 'en', child: Text('English')),
                ],
                onChanged: editable
                    ? (value) {
                        if (value != null) onCaptionLanguage(value);
                      }
                    : null,
              ),
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                value: translatedAudioEnabled,
                onChanged: editable ? onTranslatedAudio : null,
                secondary: const Icon(Icons.volume_up_outlined),
                title: const Text('请求译音'),
                subtitle: const Text('定向 TTS 尚未就绪；开启只保存偏好，不播放全局译音。'),
              ),
              const Divider(),
              if (snapshot.captions.isEmpty)
                Text(snapshot.translationStatus == 'not_ready'
                    ? '翻译运行时尚未就绪，不显示模拟字幕。'
                    : '正在等待参会者发言。')
              else
                ...snapshot.captions.reversed.take(8).toList().reversed.map(
                      (caption) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              '${caption.sourceDisplayName} · '
                              '${caption.type == 'translation.final' ? '译文' : '原文'}',
                              style: Theme.of(context).textTheme.labelMedium,
                            ),
                            const SizedBox(height: 2),
                            Text(caption.text),
                          ],
                        ),
                      ),
                    ),
            ],
          ),
        ),
      );
}

String _translationStatus(EnterpriseMeetingRoomSnapshot snapshot) {
  if (snapshot.status == EnterpriseMeetingRoomStatus.disconnected) {
    return '入会时按个人偏好申请独立字幕流。';
  }
  if (snapshot.translationStatus == 'ready') return '字幕 Worker 已就绪。';
  if (snapshot.translationStatus == 'captions_only') return '字幕已就绪，译音保持关闭。';
  return '字幕未就绪（${snapshot.translationReasonCode}）。';
}
