import 'package:flutter/material.dart';

import '../../data/enterprise_meeting_room_client.dart';

class EnterpriseMeetingRoomCard extends StatelessWidget {
  const EnterpriseMeetingRoomCard({
    required this.snapshot,
    required this.onMicrophone,
    required this.onLeave,
    super.key,
  });

  final EnterpriseMeetingRoomSnapshot snapshot;
  final Future<void> Function() onMicrophone;
  final Future<void> Function() onLeave;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Wrap(
          spacing: 10,
          runSpacing: 10,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            Text('${_roomStatus(snapshot.status)} · '
                '${snapshot.remoteParticipantCount} 位远端参会者'),
            OutlinedButton.icon(
              onPressed: onMicrophone,
              icon:
                  Icon(snapshot.microphoneEnabled ? Icons.mic : Icons.mic_off),
              label: Text(snapshot.microphoneEnabled ? '静音' : '打开麦克风'),
            ),
            OutlinedButton(
              onPressed: onLeave,
              child: const Text('离开会议'),
            ),
          ],
        ),
      ),
    );
  }
}

String _roomStatus(EnterpriseMeetingRoomStatus status) => switch (status) {
      EnterpriseMeetingRoomStatus.connecting => '正在连接',
      EnterpriseMeetingRoomStatus.connected => '已连接',
      EnterpriseMeetingRoomStatus.reconnecting => '正在重连',
      EnterpriseMeetingRoomStatus.disconnected => '已断开',
    };
