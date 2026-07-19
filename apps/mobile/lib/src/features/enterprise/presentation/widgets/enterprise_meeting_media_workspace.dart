import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:livekit_client/livekit_client.dart' as livekit;

import '../../data/enterprise_meeting_screen_ocr_models.dart';

enum _MeetingMediaLayout { screen, balanced, captions }

class EnterpriseMeetingMediaWorkspace extends StatefulWidget {
  const EnterpriseMeetingMediaWorkspace({
    required this.screenTrack,
    required this.captions,
    required this.screenOcrLayout,
    required this.screenOcrDisplayMode,
    super.key,
  });

  final livekit.RemoteVideoTrack? screenTrack;
  final Widget captions;
  final EnterpriseMobileScreenOcrLayout? screenOcrLayout;
  final String screenOcrDisplayMode;

  @override
  State<EnterpriseMeetingMediaWorkspace> createState() =>
      _EnterpriseMeetingMediaWorkspaceState();
}

class _EnterpriseMeetingMediaWorkspaceState
    extends State<EnterpriseMeetingMediaWorkspace> {
  _MeetingMediaLayout _layout = _MeetingMediaLayout.balanced;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, constraints) {
          final textScale = MediaQuery.textScalerOf(context).scale(16) / 16;
          final sideBySide = _layout == _MeetingMediaLayout.balanced &&
              constraints.maxWidth >= 840 &&
              textScale <= 1.5;
          final video = _ScreenShareViewer(
            track: widget.screenTrack,
            layout: widget.screenOcrLayout,
            displayMode: widget.screenOcrDisplayMode,
          );
          final ordered = _layout == _MeetingMediaLayout.captions
              ? <Widget>[widget.captions, video]
              : <Widget>[video, widget.captions];
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      const Row(children: <Widget>[
                        Icon(Icons.dashboard_customize_outlined),
                        SizedBox(width: 10),
                        Expanded(child: Text('会议视图')),
                      ]),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: _MeetingMediaLayout.values
                            .map((value) => ChoiceChip(
                                  avatar: Icon(_icon(value), size: 18),
                                  label: Text(_label(value)),
                                  selected: _layout == value,
                                  onSelected: (_) =>
                                      setState(() => _layout = value),
                                ))
                            .toList(growable: false),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              if (sideBySide)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Expanded(flex: 3, child: video),
                    const SizedBox(width: 12),
                    Expanded(flex: 2, child: widget.captions),
                  ],
                )
              else
                ..._separate(ordered),
            ],
          );
        },
      );
}

class _ScreenShareViewer extends StatelessWidget {
  const _ScreenShareViewer({
    required this.track,
    required this.layout,
    required this.displayMode,
  });

  final livekit.RemoteVideoTrack? track;
  final EnterpriseMobileScreenOcrLayout? layout;
  final String displayMode;

  @override
  Widget build(BuildContext context) => Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const ListTile(
              leading: Icon(Icons.screen_share_outlined),
              title: Text('共享画面'),
              subtitle: Text('按可见尺寸自动选择订阅层。'),
            ),
            AspectRatio(
              aspectRatio: 16 / 9,
              child: ColoredBox(
                color: const Color(0xff111318),
                child: track == null || track!.muted
                    ? const Center(
                        child: Text(
                          '正在等待共享画面',
                          style: TextStyle(color: Colors.white70),
                        ),
                      )
                    : Stack(
                        fit: StackFit.expand,
                        children: <Widget>[
                          livekit.VideoTrackRenderer(
                            track!,
                            fit: livekit.VideoViewFit.contain,
                          ),
                          if (layout != null && displayMode != 'original')
                            _ScreenOcrOverlay(
                              layout: layout!,
                              displayMode: displayMode,
                            ),
                        ],
                      ),
              ),
            ),
          ],
        ),
      );
}

class _ScreenOcrOverlay extends StatelessWidget {
  const _ScreenOcrOverlay({required this.layout, required this.displayMode});

  final EnterpriseMobileScreenOcrLayout layout;
  final String displayMode;

  @override
  Widget build(BuildContext context) => IgnorePointer(
        child: LayoutBuilder(builder: (context, constraints) {
          final scale = math.min(
            constraints.maxWidth / layout.sourceWidth,
            constraints.maxHeight / layout.sourceHeight,
          );
          final contentWidth = layout.sourceWidth * scale;
          final contentHeight = layout.sourceHeight * scale;
          final offsetX = (constraints.maxWidth - contentWidth) / 2;
          final offsetY = (constraints.maxHeight - contentHeight) / 2;
          return Stack(children: <Widget>[
            for (final block in layout.blocks)
              Positioned(
                left: offsetX + block.left * contentWidth,
                top: offsetY + block.top * contentHeight,
                width: block.width * contentWidth,
                height: block.height * contentHeight,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: const Color(0xe61b1d22),
                    border: Border.all(color: const Color(0xff80cbc4)),
                    borderRadius: BorderRadius.circular(3),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(
                        displayMode == 'bilingual'
                            ? '${block.sourceText}\n${block.translatedText}'
                            : block.translatedText,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                          height: 1.15,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ]);
        }),
      );
}

List<Widget> _separate(List<Widget> values) => <Widget>[
      for (var index = 0; index < values.length; index++) ...<Widget>[
        values[index],
        if (index < values.length - 1) const SizedBox(height: 12),
      ],
    ];

String _label(_MeetingMediaLayout value) => switch (value) {
      _MeetingMediaLayout.screen => '画面优先',
      _MeetingMediaLayout.balanced => '并排',
      _MeetingMediaLayout.captions => '字幕优先',
    };

IconData _icon(_MeetingMediaLayout value) => switch (value) {
      _MeetingMediaLayout.screen => Icons.slideshow_outlined,
      _MeetingMediaLayout.balanced => Icons.view_sidebar_outlined,
      _MeetingMediaLayout.captions => Icons.subtitles_outlined,
    };
