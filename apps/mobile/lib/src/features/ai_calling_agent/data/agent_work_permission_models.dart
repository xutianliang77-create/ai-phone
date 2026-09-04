class AgentWorkPermissionRequest {
  const AgentWorkPermissionRequest({
    required this.permissionRequestId,
    required this.sessionId,
    required this.legId,
    required this.turnId,
    required this.toolName,
    required this.toolVersion,
    required this.riskLevel,
    required this.sideEffectScopes,
    required this.status,
    required this.turnGeneration,
    required this.dispatchGeneration,
    required this.expiresAt,
  });

  final String permissionRequestId;
  final String sessionId;
  final String legId;
  final String turnId;
  final String toolName;
  final String toolVersion;
  final String riskLevel;
  final List<String> sideEffectScopes;
  final String status;
  final int turnGeneration;
  final int dispatchGeneration;
  final DateTime expiresAt;

  factory AgentWorkPermissionRequest.fromJson(Map<String, Object?> json) {
    String text(String key) {
      final value = json[key];
      if (value is! String || value.trim().isEmpty) {
        throw const FormatException('Invalid Agent Work permission response');
      }
      return value;
    }

    int integer(String key) {
      final value = json[key];
      if (value is! num || value.toInt() < 1 || value.toInt() != value) {
        throw const FormatException('Invalid Agent Work permission response');
      }
      return value.toInt();
    }

    final expiresAt = DateTime.tryParse(text('expiresAt'));
    final riskLevel = text('riskLevel');
    final status = text('status');
    final rawScopes = json['sideEffectScopes'];
    if (expiresAt == null ||
        !const <String>{'low', 'sensitive'}.contains(riskLevel) ||
        !const <String>{
          'pending', 'granted', 'denied', 'expired', 'cancelled',
        }.contains(status) ||
        rawScopes is! List<Object?> || rawScopes.isEmpty ||
        rawScopes.length > 8 || rawScopes.any((scope) =>
          scope is! String || scope.trim().isEmpty ||
          !const <String>{
            'none', 'memory_read', 'memory_write',
            'permission_request', 'external_read', 'external_write',
          }.contains(scope))) {
      throw const FormatException('Invalid Agent Work permission response');
    }
    final scopes = rawScopes.cast<String>().toList(growable: false);
    if (scopes.toSet().length != scopes.length ||
        (scopes.contains('none') && scopes.length != 1)) {
      throw const FormatException('Invalid Agent Work permission response');
    }
    return AgentWorkPermissionRequest(
      permissionRequestId: text('permissionRequestId'),
      sessionId: text('sessionId'),
      legId: text('legId'),
      turnId: text('turnId'),
      toolName: text('toolName'),
      toolVersion: text('toolVersion'),
      riskLevel: riskLevel,
      sideEffectScopes: scopes,
      status: status,
      turnGeneration: integer('turnGeneration'),
      dispatchGeneration: integer('dispatchGeneration'),
      expiresAt: expiresAt.toUtc(),
    );
  }
}
