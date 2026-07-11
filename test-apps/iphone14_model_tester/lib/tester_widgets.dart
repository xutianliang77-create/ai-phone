import 'dart:convert';

import 'package:flutter/material.dart';

import 'model_provider.dart';
import 'test_sample.dart';

class StatusPanel extends StatelessWidget {
  const StatusPanel({
    super.key,
    required this.status,
    required this.permission,
    required this.localeId,
    required this.recording,
    required this.eventCount,
    required this.lastSavedPath,
    required this.runId,
    required this.provider,
    required this.nativeStatus,
  });

  final String status;
  final String permission;
  final String localeId;
  final bool recording;
  final int eventCount;
  final String lastSavedPath;
  final String runId;
  final ModelProviderSpec provider;
  final Map<String, Object?> nativeStatus;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: recording ? const Color(0xfffff4df) : const Color(0xffeef4f6),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('状态：$status'),
            Text('Provider：${provider.name} / ${provider.modelId}'),
            Text('识别语言：$localeId'),
            Text('事件数：$eventCount'),
            Text('Native：${_nativeSummary(nativeStatus)}'),
            Text('Run ID：$runId', maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(
              '结果文件：$lastSavedPath',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              '权限：$permission',
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  String _nativeSummary(Map<String, Object?> status) {
    final providerStatus = status['coreMlQwen3Asr'];
    if (providerStatus is Map) {
      return jsonEncode({
        'activeProviderId': status['activeProviderId'],
        'qwen3.reason': providerStatus['reason'],
        'qwen3.modelReady': providerStatus['modelReady'],
      });
    }
    return jsonEncode({
      'activeProviderId': status['activeProviderId'],
      'isRecording': status['isRecording'],
    });
  }
}

class ProviderPicker extends StatelessWidget {
  const ProviderPicker({
    super.key,
    required this.providers,
    required this.selected,
    required this.onSelected,
  });

  final List<ModelProviderSpec> providers;
  final ModelProviderSpec selected;
  final ValueChanged<ModelProviderSpec> onSelected;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<ModelProviderSpec>(
      initialValue: selected,
      isExpanded: true,
      decoration: const InputDecoration(labelText: '测试模型 Provider'),
      items: providers.map((provider) {
        final suffix = provider.available ? '可测' : '待接入';
        return DropdownMenuItem(
          value: provider,
          child: Text('${provider.name} · ${provider.modelId} · $suffix'),
        );
      }).toList(),
      onChanged: (provider) {
        if (provider != null) onSelected(provider);
      },
    );
  }
}

class LocalePicker extends StatelessWidget {
  const LocalePicker({super.key, required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return SegmentedButton<String>(
      segments: const [
        ButtonSegment(value: 'zh-CN', label: Text('中文 ASR')),
        ButtonSegment(value: 'en-US', label: Text('英文 ASR')),
        ButtonSegment(value: 'auto', label: Text('自动')),
      ],
      selected: {value},
      onSelectionChanged: (values) => onChanged(values.first),
    );
  }
}

class SamplePicker extends StatelessWidget {
  const SamplePicker({
    super.key,
    required this.samples,
    required this.selected,
    required this.onSelected,
  });

  final List<TestSample> samples;
  final TestSample? selected;
  final ValueChanged<TestSample> onSelected;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<TestSample>(
      initialValue: selected,
      isExpanded: true,
      decoration: const InputDecoration(labelText: 'P0 样本'),
      items: samples.map((sample) {
        return DropdownMenuItem(
          value: sample,
          child: Text('${sample.id} · ${sample.group}'),
        );
      }).toList(),
      onChanged: (sample) {
        if (sample != null) onSelected(sample);
      },
    );
  }
}

class ActionBar extends StatelessWidget {
  const ActionBar({
    super.key,
    required this.recording,
    required this.onPermission,
    required this.onStart,
    required this.onStop,
    required this.onSpeak,
    required this.onCopy,
  });

  final bool recording;
  final VoidCallback onPermission;
  final VoidCallback onStart;
  final VoidCallback onStop;
  final VoidCallback onSpeak;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        FilledButton(onPressed: onPermission, child: const Text('权限')),
        FilledButton(
          onPressed: recording ? null : onStart,
          child: const Text('开始识别'),
        ),
        OutlinedButton(
          onPressed: recording ? onStop : null,
          child: const Text('停止'),
        ),
        OutlinedButton(onPressed: onSpeak, child: const Text('读期望译文')),
        OutlinedButton(onPressed: onCopy, child: const Text('复制 JSONL')),
      ],
    );
  }
}
