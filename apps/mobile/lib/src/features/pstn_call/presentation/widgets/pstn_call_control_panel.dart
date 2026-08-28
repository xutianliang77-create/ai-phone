import 'package:flutter/material.dart';

import '../../../call_link/data/call_link_api_client.dart';
import '../../../call_link/data/call_room_client.dart';
import '../../data/pstn_call_session.dart';
import 'pstn_translation_call_controls.dart';
import 'pstn_call_widgets.dart';

class PstnCallControlPanel extends StatefulWidget {
  const PstnCallControlPanel({
    required this.session,
    required this.call,
    required this.roomSnapshot,
    required this.endBusy,
    required this.hangupPending,
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
  final bool hangupPending;
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
  bool get _connected => widget.call.provider == 'air780_volte'
      ? widget.call.carrierState == 'connected'
      : widget.call.status == 'active';

  @override
  Widget build(BuildContext context) {
    final busy = widget.endBusy || widget.hangupPending || _busy;
    return Column(
      children: <Widget>[
        PstnActiveCallCard(
          call: widget.call,
          roomSnapshot: widget.roomSnapshot,
          busy: busy,
          hangupPending: widget.hangupPending,
          chinese: widget.chinese,
          onEnd: widget.onEnd,
          onDtmf: _sendDtmf,
          onTransfer: _showTransferDialog,
          supportsDtmf: widget.call.provider == 'livekit_sip' ||
              widget.call.provider == 'air780_volte',
          supportsTransfer: widget.call.provider == 'livekit_sip',
          endResult: widget.endResult,
          error: _error ?? widget.error,
        ),
        if (widget.endResult == null)
          PstnTranslationCallControls(
            busy: busy,
            connected: _connected,
            microphoneMuted: widget.session.microphoneMuted,
            uplinkPaused: widget.session.translationUplinkPaused,
            chinese: widget.chinese,
            onToggleMicrophone: _toggleMicrophone,
            onToggleUplink: _toggleTranslationUplink,
            onTypeToSpeak: _showTypeToSpeakDialog,
            onReportIssue: _showDiagnosticMarkerDialog,
          ),
      ],
    );
  }

  Future<void> _toggleMicrophone() async {
    await _runControl(() async {
      final muted = !widget.session.microphoneMuted;
      await widget.session.setMicrophoneMuted(muted);
      _message(muted
          ? _text('本机麦克风已静音', 'Microphone muted')
          : _text('本机麦克风已恢复', 'Microphone restored'));
    });
  }

  Future<void> _toggleTranslationUplink() async {
    await _runControl(() async {
      final paused = !widget.session.translationUplinkPaused;
      final result = await widget.session.setTranslationUplinkPaused(paused);
      if (result.status == 'failed' || result.status == 'cancelled') {
        throw const CallLinkApiException(
          'Translation uplink control failed',
          code: 'translation_uplink_control_failed',
        );
      }
      _message(result.isTerminal
          ? paused
              ? _text('对方暂时听不到译声', 'Translated uplink paused')
              : _text('译声上行已恢复', 'Translated uplink resumed')
          : _text('正在确认译声状态', 'Reconciling translated uplink'));
    });
  }

  Future<void> _showTypeToSpeakDialog() async {
    if (_busy || widget.session.translationUplinkPaused) return;
    final controller = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_text('输入文字让对方听到译音', 'Type to speak')),
        content: TextField(
          key: const Key('pstn-type-to-speak-field'),
          controller: controller,
          autofocus: true,
          maxLength: 240,
          minLines: 2,
          maxLines: 5,
          decoration: InputDecoration(
            hintText: _text('输入你想说的话', 'Enter what you want to say'),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(_text('取消', 'Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: Text(_text('翻译并发送', 'Translate and send')),
          ),
        ],
      ),
    );
    controller.dispose();
    if (text == null || text.isEmpty) return;
    await _runControl(() async {
      final result = await widget.session.typeToSpeak(text);
      if (result.status == 'failed' || result.status == 'cancelled') {
        throw const CallLinkApiException(
          'Type-to-speak failed',
          code: 'type_to_speak_failed',
        );
      }
      _message(result.isTerminal
          ? _text('文字已交给翻译语音链处理',
              'Typed text accepted by the translation pipeline')
          : _text('正在确认文字译音', 'Reconciling typed speech'));
    });
  }

  Future<void> _showDiagnosticMarkerDialog() async {
    if (_busy) return;
    final category = await showDialog<String>(
      context: context,
      builder: (context) => SimpleDialog(
        title: Text(_text('标记通话问题', 'Report call issue')),
        children: <Widget>[
          _issueOption('cannot_hear_remote', '听不到对方',
              'Cannot hear the other person'),
          _issueOption('callee_cannot_hear_translation', '对方听不到译音',
              'Other person cannot hear translation'),
          _issueOption('translation_incorrect', '翻译内容不正确',
              'Translation is incorrect'),
          _issueOption('unexpected_audio', '出现无关声音',
              'Unexpected audio'),
        ],
      ),
    );
    if (category == null) return;
    await _runControl(() async {
      await widget.session.reportCallIssue(category);
      if (mounted) {
        _message(_text('问题时间点已标记，不会保存通话原音。',
            'Issue marked without saving call audio.'));
      }
    });
  }

  Widget _issueOption(String value, String zh, String en) {
    return SimpleDialogOption(
      onPressed: () => Navigator.pop(context, value),
      child: Text(_text(zh, en)),
    );
  }

  Future<void> _runControl(Future<void> Function() operation) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await operation();
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendDtmf(String digit) async {
    await _runControl(() async {
      await widget.session.sendDtmf(digit);
    });
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
    await _runControl(() async {
      await widget.session.transfer(target);
      if (mounted) _message(_text('转接请求已发送', 'Transfer requested'));
    });
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
