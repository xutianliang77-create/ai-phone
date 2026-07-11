class SpeakerAttribution {
  const SpeakerAttribution({
    required this.speakerId,
    required this.role,
    required this.source,
    this.displayName,
    this.confidence,
  });

  final String speakerId;
  final String role;
  final String source;
  final String? displayName;
  final double? confidence;

  factory SpeakerAttribution.fromJson(Map<String, Object?> json) {
    return SpeakerAttribution(
      speakerId: json['speakerId'] as String? ?? 'unknown',
      role: json['role'] as String? ?? 'unknown',
      source: json['source'] as String? ?? 'unknown',
      displayName: json['displayName'] as String?,
      confidence: (json['confidence'] as num?)?.toDouble(),
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'speakerId': speakerId,
        'role': role,
        'source': source,
        if (displayName != null) 'displayName': displayName,
        if (confidence != null) 'confidence': confidence,
      };

  String label({required bool isChinese, String? localRole}) {
    final name = displayName?.trim();
    if (name != null && name.isNotEmpty) return name;
    if (localRole != null && role == localRole) return isChinese ? '我' : 'Me';
    if (localRole != null && _isCallParticipant(role)) {
      return isChinese ? '对方' : 'Other';
    }
    return switch (role) {
      'self' => isChinese ? '我' : 'Me',
      'peer' => isChinese ? '对方' : 'Other',
      'host' => isChinese ? '主持人' : 'Host',
      'guest' => isChinese ? '访客' : 'Guest',
      'agent' || 'worker' => isChinese ? 'AI 助手' : 'AI Agent',
      'speaker' => _anonymousLabel(isChinese),
      _ => isChinese ? '说话人未知' : 'Unknown speaker',
    };
  }

  bool _isCallParticipant(String value) => value == 'host' || value == 'guest';

  String sourceLabel({required bool isChinese}) {
    return switch (source) {
      'participant_track' => isChinese ? '通话音轨' : 'Participant track',
      'diarization' => isChinese ? '声纹分离' : 'Speaker diarization',
      'voice_identity' => isChinese ? '授权声音身份' : 'Consented voice identity',
      'language_role' => isChinese ? '按语言区分' : 'Language based',
      'manual' => isChinese ? '手动指定' : 'Manual',
      _ => isChinese ? '归属未知' : 'Unknown attribution',
    };
  }

  String _anonymousLabel(bool isChinese) {
    final suffix = RegExp(r'(\d+)$').firstMatch(speakerId)?.group(1);
    if (suffix == null) return isChinese ? '发言者' : 'Speaker';
    return isChinese ? '发言者 $suffix' : 'Speaker $suffix';
  }
}

class SegmentTiming {
  const SegmentTiming({
    required this.startMs,
    required this.endMs,
    required this.source,
    this.overlap = false,
  });

  final int startMs;
  final int endMs;
  final String source;
  final bool overlap;

  factory SegmentTiming.fromJson(Map<String, Object?> json) {
    return SegmentTiming(
      startMs: (json['startMs'] as num?)?.toInt() ?? 0,
      endMs: (json['endMs'] as num?)?.toInt() ?? 0,
      source: json['source'] as String? ?? 'estimated',
      overlap: json['overlap'] as bool? ?? false,
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'startMs': startMs,
        'endMs': endMs,
        'source': source,
        if (overlap) 'overlap': true,
      };
}
