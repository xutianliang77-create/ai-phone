import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../../platform/translation/language_capability_probe.dart';
import '../../../../platform/translation/supported_translation_language.dart';

class LanguageCapabilityPage extends StatefulWidget {
  const LanguageCapabilityPage({super.key});
  @override
  State<LanguageCapabilityPage> createState() => _LanguageCapabilityPageState();
}

class _LanguageCapabilityPageState extends State<LanguageCapabilityPage> {
  final _probe = const LanguageCapabilityProbe();
  final _results = <String, Future<Map<String, String>>>{};

  @override
  Widget build(BuildContext context) {
    final chinese = context.l10n.isChinese;
    return Scaffold(
      appBar: AppBar(
        title: Text(chinese ? '本机语言能力' : 'On-device language capabilities'),
      ),
      body: ListView(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              chinese
                  ? '保留原 38 项目录。展开单项读取本机资源状态，不下载资源。系统列出或资源已安装不等于质量通过。当前签名许可仅覆盖中文和英文；其他语言尚未验收，不能启用。'
                  : 'The original 38 languages are listed. Expand one to inspect resources without downloading. Installed resources do not establish quality. The current license covers Chinese and English; other languages are not qualified.',
            ),
          ),
          for (final language in supportedHyMtLanguages)
            ExpansionTile(
              title: Text(
                chinese ? language.chineseName : language.englishName,
              ),
              subtitle: Text(
                '${language.code} · ${onDeviceTranslationLanguageCodes.contains(language.code) ? (chinese ? '中英许可范围，能力待核验' : 'Within license; capability unverified') : (chinese ? '尚未验收及授权' : 'Not qualified or licensed')}',
              ),
              onExpansionChanged: (open) {
                if (open && !_results.containsKey(language.code)) {
                  final result = _probe.inspect(language.code, chinese: chinese);
                  setState(() { _results[language.code] = result; });
                }
              },
              children: [
                if (_results[language.code] != null)
                  FutureBuilder<Map<String, String>>(
                    future: _results[language.code],
                    builder: (context, snapshot) => Padding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                      child: snapshot.hasData
                          ? Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: snapshot.data!.entries
                                  .map(
                                    (entry) =>
                                        Text('${entry.key}：${entry.value}'),
                                  )
                                  .toList(),
                            )
                          : Text(
                              chinese ? '正在读取系统状态…' : 'Reading system status…',
                            ),
                    ),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}
