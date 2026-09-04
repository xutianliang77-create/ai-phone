class AppBuildIdentity {
  const AppBuildIdentity({
    required this.candidateId,
    required this.sourceCommit,
    required this.sourceTree,
    required this.sourceState,
    required this.productProfile,
  });

  static const current = AppBuildIdentity(
    candidateId: String.fromEnvironment(
      'WUJIE_CANDIDATE_ID',
      defaultValue: 'untraceable',
    ),
    sourceCommit: String.fromEnvironment(
      'SOURCE_COMMIT',
      defaultValue: 'untraceable',
    ),
    sourceTree: String.fromEnvironment(
      'SOURCE_TREE',
      defaultValue: 'untraceable',
    ),
    sourceState: String.fromEnvironment(
      'SOURCE_STATE',
      defaultValue: 'unknown',
    ),
    productProfile: String.fromEnvironment(
      'WUJIE_PRODUCT_PROFILE',
      defaultValue: 'full',
    ),
  );

  final String candidateId;
  final String sourceCommit;
  final String sourceTree;
  final String sourceState;
  final String productProfile;

  bool get isTraceable =>
      RegExp(r'^[a-f0-9]{40}$').hasMatch(sourceCommit) &&
      RegExp(r'^[a-f0-9]{40}$').hasMatch(sourceTree) &&
      sourceState == 'clean' &&
      candidateId != 'untraceable' &&
      (productProfile == 'core_translation' || productProfile == 'full');

  Map<String, Object?> toJson() => <String, Object?>{
        'candidateId': candidateId,
        'sourceCommit': sourceCommit,
        'sourceTree': sourceTree,
        'sourceState': sourceState,
        'productProfile': productProfile,
        'traceable': isTraceable,
      };
}
