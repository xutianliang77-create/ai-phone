import 'package:flutter/material.dart';

import '../../data/enterprise_meeting_material_api.dart';
import '../../data/enterprise_meeting_material_models.dart';
import '../../data/enterprise_meeting_models.dart';
import '../../data/enterprise_mobile_api_client.dart';
import '../../data/enterprise_mobile_models.dart';
import 'enterprise_meeting_material_view.dart';

class EnterpriseMeetingMaterialCard extends StatefulWidget {
  const EnterpriseMeetingMaterialCard({
    required this.client,
    required this.workspace,
    required this.aggregate,
    required this.canWrite,
    required this.connected,
    required this.onMeetingChanged,
    super.key,
  });

  final EnterpriseMobileApiClient client;
  final EnterpriseMobileWorkspace workspace;
  final EnterpriseMobileMeetingAggregate aggregate;
  final bool canWrite;
  final bool connected;
  final Future<void> Function() onMeetingChanged;

  @override
  State<EnterpriseMeetingMaterialCard> createState() =>
      _EnterpriseMeetingMaterialCardState();
}

class _EnterpriseMeetingMaterialCardState
    extends State<EnterpriseMeetingMaterialCard> {
  EnterpriseMeetingMaterial? _material;
  bool _open = false;
  bool _loading = false;
  String? _notice;
  String? _generationKey;

  @override
  Widget build(BuildContext context) {
    final meeting = widget.aggregate.meeting;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (widget.canWrite && meeting.status == 'active') ...<Widget>[
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: _loading || widget.connected ? null : _end,
            icon: const Icon(Icons.stop_circle_outlined),
            label: Text(widget.connected ? '请先离开再结束' : '结束会议'),
          ),
        ],
        if (meeting.status == 'ended') ...<Widget>[
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: _loading ? null : _toggle,
            icon: const Icon(Icons.article_outlined),
            label: Text(_open ? '收起会后材料' : '会后材料'),
          ),
        ],
        if (_notice != null) ...<Widget>[
          const SizedBox(height: 8),
          Text(_notice!, style: Theme.of(context).textTheme.bodySmall),
        ],
        if (_open) ...<Widget>[
          const Divider(height: 24),
          if (_loading)
            const Center(child: CircularProgressIndicator())
          else if (_material == null)
            _empty(meeting)
          else
            EnterpriseMeetingMaterialView(
              material: _material!,
              canWrite: widget.canWrite,
              loading: _loading,
              onGenerate: () => _generate(meeting),
              onPublish: () => _publish(_material!),
              onEditSpeaker: (participantId, current) =>
                  _editSpeaker(_material!, participantId, current),
              onComplete: (item) => _complete(_material!, item),
            ),
        ],
      ],
    );
  }

  Widget _empty(EnterpriseMobileMeeting meeting) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('尚未生成冻结版本的逐字稿与复核材料。'),
          if (widget.canWrite) ...<Widget>[
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: () => _generate(meeting),
              icon: const Icon(Icons.fact_check_outlined),
              label: const Text('生成会后材料'),
            ),
          ],
        ],
      );

  Future<void> _toggle() async {
    if (_open) {
      setState(() => _open = false);
      return;
    }
    setState(() {
      _open = true;
      _loading = true;
      _notice = null;
    });
    try {
      final material = await widget.client.currentMeetingMaterial(
        widget.workspace,
        widget.aggregate.meeting.id,
      );
      if (mounted) setState(() => _material = material);
    } catch (error) {
      if (mounted) setState(() => _notice = _error(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _end() async => _work(() async {
        await widget.client.endMeetingForMaterials(
          widget.workspace,
          widget.aggregate.meeting.id,
          widget.aggregate.meeting.version,
        );
        _notice = '会议已结束，可生成冻结版本材料。';
        await widget.onMeetingChanged();
      });

  Future<void> _generate(EnterpriseMobileMeeting meeting) async =>
      _work(() async {
        final key = _generationKey ??
            '${DateTime.now().microsecondsSinceEpoch}-material';
        _generationKey = key;
        try {
          _material = await widget.client.generateMeetingMaterial(
            widget.workspace,
            meeting.id,
            meeting.version,
            key,
          );
          _generationKey = null;
        } on EnterpriseMobileApiException catch (error) {
          if (error.statusCode == 409) _generationKey = null;
          rethrow;
        }
        _notice = _material!.run.reviewStatus == 'ready'
            ? '逐字稿与待复核结论已生成。'
            : '逐字稿已冻结；AI 复核未就绪，未伪造摘要或待办。';
        await widget.onMeetingChanged();
      });

  Future<void> _publish(EnterpriseMeetingMaterial material) async =>
      _work(() async {
        _material = await widget.client
            .publishMeetingMaterial(widget.workspace, material);
        _notice = '会后材料已发布并记录审计。';
      });

  Future<void> _complete(
    EnterpriseMeetingMaterial material,
    EnterpriseMeetingMaterialActionItem item,
  ) async =>
      _work(() async {
        _material = await widget.client.updateMeetingMaterialAction(
          widget.workspace,
          material,
          item,
          'completed',
        );
        _notice = '待办状态已更新。';
      });

  Future<void> _editSpeaker(
    EnterpriseMeetingMaterial material,
    String participantId,
    String current,
  ) async {
    final controller = TextEditingController(text: current);
    final value = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('修正本次会议说话人'),
              content: TextField(
                  controller: controller, maxLength: 120, autofocus: true),
              actions: <Widget>[
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('取消')),
                FilledButton(
                    onPressed: () =>
                        Navigator.pop(context, controller.text.trim()),
                    child: const Text('保存')),
              ],
            ));
    controller.dispose();
    if (value == null || value.isEmpty || value == current) return;
    await _work(() async {
      _material = await widget.client.updateMeetingMaterialSpeaker(
        widget.workspace,
        material,
        participantId,
        value,
      );
      _notice = '名称仅修正了本次会议材料。';
    });
  }

  Future<void> _work(Future<void> Function() operation) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _notice = null;
    });
    try {
      await operation();
    } catch (error) {
      _notice = _error(error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }
}

String _error(Object error) {
  if (error is EnterpriseMobileApiException) {
    if (error.statusCode == 401 || error.statusCode == 403) {
      return '当前身份无权管理会后材料。';
    }
    if (error.statusCode == 409) return '会议或材料版本已变化，请刷新后重试。';
    if (error.statusCode == 503) return '企业材料服务或 Provider 尚未就绪。';
  }
  return '会后材料请求失败；未使用本地字幕或示例纪要回退。';
}
