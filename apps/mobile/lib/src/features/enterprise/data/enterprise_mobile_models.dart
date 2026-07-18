class EnterpriseMobileTenant {
  const EnterpriseMobileTenant({
    required this.id,
    required this.name,
    required this.status,
    required this.homeRegion,
    required this.planCode,
    required this.version,
    this.cellId,
  });

  final String id;
  final String name;
  final String status;
  final String homeRegion;
  final String? cellId;
  final String planCode;
  final int version;

  factory EnterpriseMobileTenant.fromJson(Map<String, Object?> json) {
    return EnterpriseMobileTenant(
      id: _text(json, 'id'),
      name: _text(json, 'name'),
      status: _text(json, 'status'),
      homeRegion: _text(json, 'homeRegion'),
      cellId: _optionalText(json, 'cellId'),
      planCode: _text(json, 'planCode'),
      version: _integer(json, 'version'),
    );
  }
}

class EnterpriseMobileMember {
  const EnterpriseMobileMember({
    required this.id,
    required this.tenantId,
    required this.userId,
    required this.role,
    required this.status,
    required this.version,
  });

  final String id;
  final String tenantId;
  final String userId;
  final String role;
  final String status;
  final int version;

  factory EnterpriseMobileMember.fromJson(Map<String, Object?> json) {
    return EnterpriseMobileMember(
      id: _text(json, 'id'),
      tenantId: _text(json, 'tenantId'),
      userId: _text(json, 'userId'),
      role: _text(json, 'role'),
      status: _text(json, 'status'),
      version: _integer(json, 'version'),
    );
  }
}

class EnterpriseMobileMembership {
  const EnterpriseMobileMembership({
    required this.tenant,
    required this.member,
  });

  final EnterpriseMobileTenant tenant;
  final EnterpriseMobileMember member;

  factory EnterpriseMobileMembership.fromJson(Map<String, Object?> json) {
    return EnterpriseMobileMembership(
      tenant: EnterpriseMobileTenant.fromJson(_map(json, 'tenant')),
      member: EnterpriseMobileMember.fromJson(_map(json, 'member')),
    );
  }
}

class EnterpriseMobileContext extends EnterpriseMobileMembership {
  const EnterpriseMobileContext({
    required super.tenant,
    required super.member,
    required this.scopes,
  });

  final Set<String> scopes;

  factory EnterpriseMobileContext.fromJson(Map<String, Object?> json) {
    final membership = EnterpriseMobileMembership.fromJson(json);
    final scopes = json['scopes'];
    if (scopes is! List<Object?> || scopes.any((value) => value is! String)) {
      throw const FormatException('Invalid enterprise scopes');
    }
    return EnterpriseMobileContext(
      tenant: membership.tenant,
      member: membership.member,
      scopes: scopes.cast<String>().toSet(),
    );
  }

  bool can(String scope) => scopes.contains(scope);
}

class EnterpriseMobileRoute {
  const EnterpriseMobileRoute({
    required this.tenantId,
    required this.homeRegion,
    required this.cellId,
    required this.routeEpoch,
    required this.apiBaseUrl,
    required this.rtcUrl,
    required this.issuedAt,
    required this.expiresAt,
    required this.signature,
  });

  final String tenantId;
  final String homeRegion;
  final String cellId;
  final int routeEpoch;
  final Uri apiBaseUrl;
  final Uri rtcUrl;
  final DateTime issuedAt;
  final DateTime expiresAt;
  final String signature;

  factory EnterpriseMobileRoute.fromJson(Map<String, Object?> json) {
    return EnterpriseMobileRoute(
      tenantId: _text(json, 'tenantId'),
      homeRegion: _text(json, 'homeRegion'),
      cellId: _text(json, 'cellId'),
      routeEpoch: _integer(json, 'routeEpoch'),
      apiBaseUrl: Uri.parse(_text(json, 'apiBaseUrl')),
      rtcUrl: Uri.parse(_text(json, 'rtcUrl')),
      issuedAt: DateTime.parse(_text(json, 'issuedAt')),
      expiresAt: DateTime.parse(_text(json, 'expiresAt')),
      signature: _text(json, 'signature'),
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'tenantId': tenantId,
        'homeRegion': homeRegion,
        'cellId': cellId,
        'routeEpoch': routeEpoch,
        'apiBaseUrl': apiBaseUrl.toString(),
        'rtcUrl': rtcUrl.toString(),
        'issuedAt': issuedAt.toUtc().toIso8601String(),
        'expiresAt': expiresAt.toUtc().toIso8601String(),
        'signature': signature,
      };
}

class EnterpriseMobileProviderCapability {
  const EnterpriseMobileProviderCapability({
    required this.capability,
    required this.provider,
    required this.status,
    required this.region,
    this.reasonCode,
  });

  final String capability;
  final String provider;
  final String status;
  final String region;
  final String? reasonCode;

  factory EnterpriseMobileProviderCapability.fromJson(
    Map<String, Object?> json,
  ) {
    return EnterpriseMobileProviderCapability(
      capability: _text(json, 'capability'),
      provider: _text(json, 'provider'),
      status: _text(json, 'status'),
      region: _text(json, 'region'),
      reasonCode: _optionalText(json, 'reasonCode'),
    );
  }
}

class EnterpriseMobileWorkspace {
  const EnterpriseMobileWorkspace({
    required this.token,
    required this.context,
    required this.route,
    required this.providers,
  });

  final String token;
  final EnterpriseMobileContext context;
  final EnterpriseMobileRoute route;
  final List<EnterpriseMobileProviderCapability> providers;
}

Map<String, Object?> _map(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! Map<String, Object?>) {
    throw FormatException('Invalid enterprise $key');
  }
  return value;
}

String _text(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid enterprise $key');
  }
  return value;
}

String? _optionalText(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid enterprise $key');
  }
  return value;
}

int _integer(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! int || value < 1) {
    throw FormatException('Invalid enterprise $key');
  }
  return value;
}
