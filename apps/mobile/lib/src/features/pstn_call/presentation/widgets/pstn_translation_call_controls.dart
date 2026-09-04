import 'package:flutter/material.dart';

class PstnTranslationCallControls extends StatelessWidget {
  const PstnTranslationCallControls({
    required this.busy,
    required this.connected,
    required this.microphoneMuted,
    required this.uplinkPaused,
    required this.chinese,
    required this.onToggleMicrophone,
    required this.onToggleUplink,
    required this.onTypeToSpeak,
    required this.onReportIssue,
    super.key,
  });

  final bool busy;
  final bool connected;
  final bool microphoneMuted;
  final bool uplinkPaused;
  final bool chinese;
  final VoidCallback onToggleMicrophone;
  final VoidCallback onToggleUplink;
  final VoidCallback onTypeToSpeak;
  final VoidCallback onReportIssue;

  @override
  Widget build(BuildContext context) {
    final enabled = connected && !busy;
    return Card(
      key: const Key('pstn-translation-controls'),
      margin: const EdgeInsets.only(top: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              _text('通话声音控制', 'Call audio controls'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 6),
            Text(_text(
              '本机原声只送翻译 Worker；对方只接收翻译后的语音。',
              'Your raw voice goes only to the translation worker; the other person receives translated speech only.',
            )),
            const SizedBox(height: 12),
            Row(
              children: <Widget>[
                Expanded(
                  child: OutlinedButton.icon(
                    key: const Key('pstn-microphone-toggle'),
                    onPressed: enabled ? onToggleMicrophone : null,
                    icon: Icon(microphoneMuted
                        ? Icons.mic_off_outlined
                        : Icons.mic_outlined),
                    label: Text(microphoneMuted
                        ? _text('恢复麦克风', 'Unmute mic')
                        : _text('本机静音', 'Mute mic')),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    key: const Key('pstn-uplink-toggle'),
                    onPressed: enabled ? onToggleUplink : null,
                    icon: Icon(uplinkPaused
                        ? Icons.volume_up_outlined
                        : Icons.pause_circle_outline),
                    label: Text(uplinkPaused
                        ? _text('恢复译声', 'Resume translation')
                        : _text('暂停译声', 'Pause translation')),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: FilledButton.tonalIcon(
                key: const Key('pstn-type-to-speak'),
                onPressed: enabled && !uplinkPaused ? onTypeToSpeak : null,
                icon: const Icon(Icons.keyboard_alt_outlined),
                label: Text(_text(
                  '输入文字并播放译音',
                  'Type and play translated speech',
                )),
              ),
            ),
            const SizedBox(height: 4),
            SizedBox(
              width: double.infinity,
              child: TextButton.icon(
                key: const Key('pstn-report-call-issue'),
                onPressed: connected && !busy ? onReportIssue : null,
                icon: const Icon(Icons.flag_outlined),
                label: Text(_text('标记通话声音问题', 'Report an audio issue')),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _text(String zh, String en) => chinese ? zh : en;
}
