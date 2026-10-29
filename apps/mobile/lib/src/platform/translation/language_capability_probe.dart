import 'package:flutter/services.dart';

import '../asr/apple_speech_asr_provider.dart';
import '../asr/mobile_asr_provider.dart';

/// Reads OS inventory only: no resource download, sample, server or license
/// issuance. Installed resources do not imply language quality qualification.
class LanguageCapabilityProbe {
  const LanguageCapabilityProbe();
  static const _ocr = MethodChannel('translation_mobile/ocr');
  static const _asr = MethodChannel('translation_mobile/apple_speech_asr');
  static const _mt = MethodChannel('translation_mobile/on_device_translation');
  static const _tts = MethodChannel('translation_mobile/speech_output');

  Future<Map<String, String>> inspect(
    String language, {
    bool chinese = true,
  }) async {
    String t(String zh, String en) => chinese ? zh : en;
    final partner = language == 'en' ? 'zh' : 'en';
    final arguments = AppleSpeechAsrProvider().arguments(
      MobileAsrConfig(language: language),
    );
    final results = await Future.wait<String>([
      _safe(() async {
        final locales =
            await _ocr.invokeListMethod<String>('supportedLanguages') ??
            const [];
        final matches = locales
            .where((v) => _canonical(v) == _canonical(language))
            .toList();
        return matches.isEmpty
            ? t('未匹配，需核验语种及地区', 'No exact match; check language and region')
            : t(
                '系统列出 ${matches.join('、')}；识别质量待验收',
                'System lists ${matches.join(', ')}; quality not qualified',
              );
      }, chinese),
      _safe(() async {
        final p =
            await _asr.invokeMapMethod<String, Object?>(
              'isAvailable',
              arguments,
            ) ??
            {};
        final locale = p['locale'] as String?;
        if (locale != null && _canonical(locale) != _canonical(language)) {
          return t(
            '系统返回 $locale，语言变体需核验',
            'System returned $locale; variant needs verification',
          );
        }
        if (p['resourcesInstalled'] == true) {
          return t(
            '资源已安装（$locale）；质量待验收',
            'Resource installed ($locale); quality not qualified',
          );
        }
        return '${t('未就绪', 'Not ready')}: ${p['reason'] ?? 'unknown'}${locale == null ? '' : ' ($locale)'}';
      }, chinese),
      _translation(language, partner, chinese),
      _translation(partner, language, chinese),
      _safe(() async {
        final voices =
            await _tts.invokeListMethod<Object?>('voices', {
              'language': language,
            }) ??
            const [];
        return voices.isEmpty
            ? t('未找到符合语言的系统声音', 'No matching system voice found')
            : t(
                '系统列出 ${voices.length} 种声音；离线与音质待验收',
                '${voices.length} system voices; offline and quality not qualified',
              );
      }, chinese),
    ]);
    return {
      t('文字识别', 'OCR'): results[0],
      t('语音识别', 'Speech recognition'): results[1],
      '${t('翻译', 'Translation')} $language → $partner': results[2],
      '${t('翻译', 'Translation')} $partner → $language': results[3],
      t('系统朗读', 'System voice'): results[4],
    };
  }

  Future<String> _translation(String source, String target, bool chinese) =>
      _safe(() async {
        final p =
            await _mt.invokeMapMethod<String, Object?>('isAvailable', {
              'sourceLanguage': source,
              'targetLanguage': target,
            }) ??
            {};
        if (p['available'] == true && p['status'] == 'installed') {
          return chinese
              ? '资源已安装；质量待验收'
              : 'Resource installed; quality not qualified';
        }
        if (p['status'] == 'supported') {
          return chinese
              ? '系统支持，资源需准备'
              : 'Supported; resource needs preparation';
        }
        if (p['status'] == 'unsupported' ||
            p['reason'] == 'unsupported_language_pair') {
          return chinese ? '系统未提供该方向' : 'Direction not provided by the system';
        }
        return '${chinese ? '状态未知' : 'Unknown'}: ${p['reason'] ?? 'unknown'}';
      }, chinese);

  Future<String> _safe(Future<String> Function() query, bool chinese) async {
    try {
      return await query();
    } catch (_) {
      return chinese ? '暂时无法查询' : 'Could not query';
    }
  }

  String _canonical(String raw) {
    final value = raw.toLowerCase().replaceAll('_', '-');
    final parts = value.split('-');
    if (parts.first == 'zh' || parts.first == 'cmn') {
      if (parts.contains('hk') || parts.contains('mo')) return value;
      if (parts.contains('hant') || parts.contains('tw')) return 'zh-hant';
      return 'zh';
    }
    return parts.first;
  }
}
