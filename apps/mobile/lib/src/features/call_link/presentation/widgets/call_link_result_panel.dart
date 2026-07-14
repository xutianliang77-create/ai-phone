import 'package:flutter/material.dart';

import '../../../../app/localization/app_call_link_localizations.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../data/call_link_api_client.dart';
import '../../data/call_room_client.dart';
import 'call_room_captions.dart';

class CallLinkResultPanel extends StatelessWidget {
  const CallLinkResultPanel({
    required this.link,
    required this.roomSnapshot,
    required this.roomBusy,
    required this.endResult,
    required this.onEnterRoom,
    required this.onEndRoom,
    required this.onShare,
    super.key,
  });

  final CallLink link;
  final CallRoomSnapshot roomSnapshot;
  final bool roomBusy;
  final CallLinkEndResult? endResult;
  final VoidCallback onEnterRoom;
  final VoidCallback onEndRoom;
  final ValueChanged<String> onShare;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text('${l10n.callRoomName}：${link.roomName}'),
        const SizedBox(height: 4),
        Text('${l10n.callRoomProvider}：${link.roomProvider}'),
        const SizedBox(height: 12),
        _CallRoomStatus(
          snapshot: roomSnapshot,
          waitingGuestCount: link.activeGuestCount,
        ),
        if (endResult != null) ...[
          const SizedBox(height: 8),
          Text('${l10n.callRoomSaved}：${endResult!.consumedSeconds} 秒'),
        ],
        CallRoomCaptions(
          captions: roomSnapshot.captions,
          localRole: 'host',
        ),
        if (endResult == null) ...[
          const SizedBox(height: 12),
          _CallRoomButton(
            snapshot: roomSnapshot,
            busy: roomBusy,
            onEnterRoom: onEnterRoom,
            onEndRoom: onEndRoom,
          ),
        ],
        const SizedBox(height: 12),
        SelectableText(link.joinUrl),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () => onShare(link.joinUrl),
          icon: const Icon(Icons.ios_share),
          label: Text(l10n.shareCallLink),
        ),
      ],
    );
  }
}

class _CallRoomStatus extends StatelessWidget {
  const _CallRoomStatus({
    required this.snapshot,
    required this.waitingGuestCount,
  });

  final CallRoomSnapshot snapshot;
  final int waitingGuestCount;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text('${l10n.callRoomConnectionStatus}：${_statusText(l10n)}'),
        const SizedBox(height: 4),
        Text(
          '${l10n.callRoomRemoteParticipants}：'
          '${_remoteParticipantCount()}',
        ),
        if (snapshot.message != null) ...[
          const SizedBox(height: 4),
          Text(snapshot.message!),
        ],
      ],
    );
  }

  int _remoteParticipantCount() {
    return switch (snapshot.status) {
      CallRoomConnectionStatus.disconnected ||
      CallRoomConnectionStatus.connecting =>
        waitingGuestCount,
      CallRoomConnectionStatus.connected ||
      CallRoomConnectionStatus.reconnecting =>
        snapshot.remoteParticipantCount,
    };
  }

  String _statusText(AppLocalizations l10n) {
    return switch (snapshot.status) {
      CallRoomConnectionStatus.connecting => l10n.callRoomConnecting,
      CallRoomConnectionStatus.connected => snapshot.microphoneEnabled
          ? l10n.callRoomConnected
          : l10n.callRoomConnectedNoMic,
      CallRoomConnectionStatus.reconnecting => l10n.callRoomReconnecting,
      CallRoomConnectionStatus.disconnected => l10n.callRoomDisconnected,
    };
  }
}

class _CallRoomButton extends StatelessWidget {
  const _CallRoomButton({
    required this.snapshot,
    required this.busy,
    required this.onEnterRoom,
    required this.onEndRoom,
  });

  final CallRoomSnapshot snapshot;
  final bool busy;
  final VoidCallback onEnterRoom;
  final VoidCallback onEndRoom;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final active = snapshot.status == CallRoomConnectionStatus.connected ||
        snapshot.status == CallRoomConnectionStatus.reconnecting;
    return FilledButton.icon(
      onPressed: busy
          ? null
          : active
              ? onEndRoom
              : onEnterRoom,
      icon: Icon(active ? Icons.call_end : Icons.mic),
      label: Text(active ? l10n.endAndSaveCallRoom : l10n.enterCallRoom),
    );
  }
}
