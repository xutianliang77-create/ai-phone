import 'package:flutter/material.dart';

import '../../../call_link/data/call_link_api_client.dart';
import '../../../call_link/data/call_room_client.dart';
import '../../data/pstn_call_session.dart';
import 'pstn_call_widgets.dart';

class PstnCallControlPanel extends StatefulWidget {
  const PstnCallControlPanel({
    required this.session,
    required this.call,
    required this.roomSnapshot,
    required this.endBusy,
    required this.chinese,
    required this.onEnd,
    required this.defaultCountry,
    this.endResult,
    this.error,
    super.key,
  });

  final PstnCallSession session;
  final SipOutboundCall call;
  final CallRoomSnapshot roomSnapshot;
  final bool endBusy;
  final bool chinese;
  final VoidCallback onEnd;
  final String defaultCountry;
  final CallLinkEndResult? endResult;
  final Object? error;

  @override
  State<PstnCallControlPanel> createState() => _PstnCallControlPanelState();
}

class _PstnCallControlPanelState extends State<PstnCallControlPanel> {
  bool _busy = false;
  Object? _error;

  @override
  Widget build(BuildContext context) {
    return PstnActiveCallCard(
      call: widget.call,
      roomSnapshot: widget.roomSnapshot,
      busy: widget.endBusy || _busy,
      chinese: widget.chinese,
      onEnd: widget.onEnd,
      onDtmf: _sendDtmf,
      onTransfer: _showTransferDialog,
      supportsSipControls: widget.call.provider == 'livekit_sip',
      endResult: widget.endResult,
      error: _error ?? widget.error,
    );
  }

  Future<void> _sendDtmf(String digit) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.session.sendDtmf(digit);
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showTransferDialog() async {
    if (_busy) return;
    final controller = TextEditingController();
    final target = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_text('转接电话', 'Transfer call')),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.phone,
          autofocus: true,
          decoration: InputDecoration(
            labelText: _text('转接号码', 'Transfer number'),
            hintText: '+86 138 0013 8000',
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(_text('取消', 'Cancel')),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(context, _normalize(controller.text)),
            child: Text(_text('确认转接', 'Transfer')),
          ),
        ],
      ),
    );
    controller.dispose();
    if (target == null || !RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(target)) {
      if (target != null) _message(_text('转接号码无效', 'Invalid transfer number'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.session.transfer(target);
      if (mounted) _message(_text('转接请求已发送', 'Transfer requested'));
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _normalize(String value) {
    var phone = value.replaceAll(RegExp(r'[^\d+]'), '');
    if (!phone.startsWith('+') &&
        widget.defaultCountry == 'CN' &&
        RegExp(r'^1[3-9]\d{9}$').hasMatch(phone)) {
      phone = '+86$phone';
    }
    return phone;
  }

  void _message(String value) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }

  String _text(String zh, String en) => widget.chinese ? zh : en;
}
