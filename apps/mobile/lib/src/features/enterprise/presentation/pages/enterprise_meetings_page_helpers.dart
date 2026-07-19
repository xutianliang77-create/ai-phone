part of 'enterprise_meetings_page.dart';

extension on _EnterpriseMeetingsPageState {
  Widget _meetingCard(EnterpriseMobileMeetingAggregate aggregate) {
    final meeting = aggregate.meeting;
    final joinable = const <String>{'scheduled', 'provisioning', 'active'}
        .contains(meeting.status);
    final role = widget.workspace.context.member.role;
    final canJoin = role != 'auditor' && joinable;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(children: <Widget>[
              Icon(
                Icons.groups_outlined,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  meeting.title,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              Text(_statusLabel(meeting.status)),
            ]),
            const SizedBox(height: 12),
            Text('${aggregate.participantCount} 位参会者 · '
                '${aggregate.communicationStatus ?? 'not_ready'}'),
            const SizedBox(height: 4),
            Text(
              _meetingTime(meeting),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: canJoin && !_joining && _activeMeetingId == null
                  ? () => _join(meeting.id)
                  : null,
              icon: const Icon(Icons.login),
              label: Text(
                _activeMeetingId == meeting.id ? '已加入' : '加入会议',
              ),
            ),
            EnterpriseMeetingMaterialCard(
              client: widget.client,
              workspace: widget.workspace,
              aggregate: aggregate,
              canWrite: widget.workspace.context.can('meeting:write') &&
                  (widget.workspace.context.member.role == 'owner' ||
                      widget.workspace.context.member.role == 'admin' ||
                      widget.workspace.context.member.userId ==
                          meeting.hostUserId),
              connected: _activeMeetingId == meeting.id,
              onMeetingChanged: _load,
            ),
          ],
        ),
      ),
    );
  }
}

class _PageBody extends StatelessWidget {
  const _PageBody({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: children,
      );
}

String _errorLabel(Object error) {
  if (error is EnterpriseMobileApiException) {
    if (error.code == 'meeting_not_started') return '会议尚未开始。';
    if (error.statusCode == 401 || error.statusCode == 403) {
      return '当前身份无权入会。';
    }
    if (error.statusCode == 503) return '企业会议或 RTC Provider 尚未就绪。';
  }
  return '会议请求失败；未回退到个人 Call Link 或示例数据。';
}

String _statusLabel(String status) => switch (status) {
      'scheduled' => '已预约',
      'provisioning' => '准备中',
      'active' => '进行中',
      'ending' => '结束中',
      'ended' => '已结束',
      'cancelled' => '已取消',
      'failed' => '失败',
      _ => status,
    };

String _meetingTime(EnterpriseMobileMeeting meeting) {
  final time = (meeting.scheduledAt ?? meeting.createdAt).toLocal();
  String two(int value) => value.toString().padLeft(2, '0');
  return '${time.year}-${two(time.month)}-${two(time.day)} '
      '${two(time.hour)}:${two(time.minute)}';
}
