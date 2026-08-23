class AppBuildIdentity {
  const AppBuildIdentity({
    required this.candidateId,
    required this.sourceCommit,
    required this.sourceTree,
    required this.sourceState,
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
  );

  final String candidateId;
  final String sourceCommit;
  final String sourceTree;
  final String sourceState;

  bool get isTraceable =>
      RegExp(r'^[a-f0-9]{40}$').hasMatch(sourceCommit) &&
      RegExp(r'^[a-f0-9]{40}$').hasMatch(sourceTree) &&
      sourceState == 'clean' &&
      candidateId != 'untraceable';

  Map<String, Object?> toJson() => <String, Object?>{
        'candidateId': candidateId,
        'sourceCommit': sourceCommit,
        'sourceTree': sourceTree,
        'sourceState': sourceState,
        'traceable': isTraceable,
      };
}
