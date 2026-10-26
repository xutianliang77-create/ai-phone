import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../app/app_config.dart';
import '../../../../platform/asr/apple_speech_asr_provider.dart';
import '../controllers/realtime_runtime_factories.dart';

/// Only an explicit tap authorizes OS resource preparation. Actual installed
/// status is read back; locale inventory or a completed download is insufficient.
class OnDeviceResourcesPage extends StatefulWidget {
  const OnDeviceResourcesPage({required this.config, super.key});
  final AppConfig config;
  @override
  State<OnDeviceResourcesPage> createState() => _OnDeviceResourcesPageState();
}

class _OnDeviceResourcesPageState extends State<OnDeviceResourcesPage> {
  final _asr = AppleSpeechAsrProvider();
  static const _mt = MethodChannel('translation_mobile/on_device_translation');
  static const _tts = MethodChannel('translation_mobile/speech_output');
  String? _request, _message;
  bool get busy => _request != null;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('离线语言资源')),
    body: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text(
          '首次使用需联网确认系统中英语言资源。准备完成后，识别、翻译与朗读均在本机处理。Apple 系统资源由 iOS 管理，并非全部包含在安装包中。',
        ),
        const SizedBox(height: 12),
        for (final lang in const ['zh', 'en'])
          OutlinedButton(
            onPressed: busy ? null : () => _prepare(lang),
            child: Text('准备${lang == 'zh' ? '中文' : '英文'}识别及双向翻译'),
          ),
        if (busy) TextButton(onPressed: _cancel, child: const Text('取消准备')),
        if (_message != null) Text(_message!),
        const Text('自动语种切换尚未通过验证；同传请明确选择中文或英文。声音缺失时请在 iOS 设置中安装对应的系统声音后重新检查。'),
      ],
    ),
  );
  Future<void> _prepare(String language) async {
    final id = 'resource-${DateTime.now().microsecondsSinceEpoch}';
    setState(() {
      _request = id;
      _message = '正在准备系统语言资源…';
    });
    try {
      await _asr.requestPermission();
      final c = createDeviceAsrConfig(
        widget.config.copyWith(sourceLanguage: language),
      );
      await _asr.prepareResources(c, id);
      final availability = await _asr.availability(c);
      if (!availability.canStart ||
          availability.details['resourcesInstalled'] != true) {
        throw StateError('asr_resource_not_installed');
      }
      for (final source in const ['zh', 'en']) {
        final pair = {
          'sourceLanguage': source,
          'targetLanguage': source == 'zh' ? 'en' : 'zh',
        };
        await _mt.invokeMethod<void>('prepare', {
          ...pair,
          'requestId': id,
          'downloadAuthorized': true,
        });
        final mt = await _mt.invokeMapMethod<String, Object?>(
          'isAvailable',
          pair,
        );
        if (mt?['available'] != true || mt?['status'] != 'installed') {
          throw StateError('translation_resource_not_installed');
        }
        final tts = await _tts.invokeMapMethod<String, Object?>(
          'availability',
          {'language': source},
        );
        if (tts?['canSpeak'] != true || tts?['availableOnDevice'] != true) {
          throw StateError('speech_voice_unavailable');
        }
      }
      if (mounted) setState(() => _message = '本次语言资源检查完成。请返回同传，选择对应语言后开始。');
    } catch (_) {
      if (mounted) {
        setState(() => _message = '资源未准备完成。请确认系统提示、网络和可用空间后重试；不会回退到线上模型。');
      }
    } finally {
      if (mounted) setState(() => _request = null);
    }
  }

  Future<void> _cancel() async {
    final id = _request;
    if (id == null) return;
    await _asr.cancelPreparation(id);
    await _mt.invokeMethod<void>('cancelPreparation', {'requestId': id});
  }

  @override
  void dispose() {
    if (_request != null) {
      _cancel();
    }
    super.dispose();
  }
}
