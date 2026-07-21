import 'dart:async';

import 'package:flutter/material.dart';

class AutoFollowScrollView extends StatefulWidget {
  const AutoFollowScrollView({
    required this.tailKey,
    required this.children,
    required this.jumpToLatestLabel,
    super.key,
    this.padding,
  });

  final String tailKey;
  final List<Widget> children;
  final String jumpToLatestLabel;
  final EdgeInsetsGeometry? padding;

  @override
  State<AutoFollowScrollView> createState() => _AutoFollowScrollViewState();
}

class _AutoFollowScrollViewState extends State<AutoFollowScrollView> {
  static const double _bottomThreshold = 72;

  final _scrollController = ScrollController();
  String _lastTailKey = '';
  bool _followLatest = true;
  bool _showJumpToLatest = false;
  bool _scrollScheduled = false;
  bool _scrollAnimating = false;
  bool _scrollPending = false;
  bool _userScrollActive = false;

  @override
  void initState() {
    super.initState();
    _lastTailKey = widget.tailKey;
    if (widget.tailKey.isNotEmpty) _scheduleScrollToLatest();
  }

  @override
  void didUpdateWidget(covariant AutoFollowScrollView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.tailKey == _lastTailKey) return;
    _lastTailKey = widget.tailKey;
    if (_followLatest || _isNearBottom) {
      _followLatest = true;
      _scheduleScrollToLatest();
    } else if (!_showJumpToLatest) {
      setState(() => _showJumpToLatest = true);
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: <Widget>[
        NotificationListener<ScrollNotification>(
          onNotification: _handleScrollNotification,
          child: ListView(
            controller: _scrollController,
            padding: widget.padding,
            children: widget.children,
          ),
        ),
        if (_showJumpToLatest)
          Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: FilledButton.icon(
                onPressed: _jumpToLatest,
                icon: const Icon(Icons.keyboard_arrow_down),
                label: Text(widget.jumpToLatestLabel),
              ),
            ),
          ),
      ],
    );
  }

  bool _handleScrollNotification(ScrollNotification notification) {
    if (notification.metrics.axis != Axis.vertical) return false;
    if (notification is ScrollStartNotification &&
        notification.dragDetails != null) {
      _userScrollActive = true;
    }
    final userDriven = _userScrollActive ||
        notification is ScrollUpdateNotification &&
            notification.dragDetails != null ||
        notification is OverscrollNotification &&
            notification.dragDetails != null;
    if (!userDriven) return false;
    final nearBottom = notification.metrics.extentAfter <= _bottomThreshold;
    if (nearBottom != _followLatest || _showJumpToLatest == nearBottom) {
      setState(() {
        _followLatest = nearBottom;
        _showJumpToLatest = !nearBottom;
      });
    }
    if (notification is ScrollEndNotification) _userScrollActive = false;
    return false;
  }

  bool get _isNearBottom {
    if (!_scrollController.hasClients) return true;
    final position = _scrollController.position;
    if (!position.hasContentDimensions) return true;
    return position.extentAfter <= _bottomThreshold;
  }

  void _jumpToLatest() {
    setState(() {
      _followLatest = true;
      _showJumpToLatest = false;
    });
    _scheduleScrollToLatest();
  }

  void _scheduleScrollToLatest({int retries = 8}) {
    if (_scrollScheduled || _scrollAnimating) {
      _scrollPending = true;
      return;
    }
    _scrollScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_scrollToLatest(retries));
    });
  }

  Future<void> _scrollToLatest(int retries) async {
    _scrollScheduled = false;
    if (!mounted || !_scrollController.hasClients) return;
    final position = _scrollController.position;
    if (!position.hasContentDimensions) {
      if (retries > 0) _scheduleScrollToLatest(retries: retries - 1);
      return;
    }
    final targetOffset = position.maxScrollExtent;
    if (!targetOffset.isFinite) return;
    _scrollAnimating = true;
    try {
      await _scrollController.animateTo(
        targetOffset,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    } catch (_) {
      // A real user drag may cancel programmatic scrolling.
    } finally {
      _scrollAnimating = false;
    }
    if (!mounted) return;
    if (!_isNearBottom && !_followLatest) {
      _scrollPending = false;
      return;
    }
    if (!_isNearBottom && retries > 0) {
      _scheduleScrollToLatest(retries: retries - 1);
      return;
    }
    if (_followLatest != true || _showJumpToLatest) {
      setState(() {
        _followLatest = true;
        _showJumpToLatest = false;
      });
    }
    if (_scrollPending) {
      _scrollPending = false;
      _scheduleScrollToLatest();
    }
  }
}
