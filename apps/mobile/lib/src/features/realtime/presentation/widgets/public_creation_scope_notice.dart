import 'package:flutter/material.dart';
import '../../../account/data/account_session_store.dart' show configuredPublicDeploymentId;
import '../../data/api/public_creation_contract.dart' show publicCreationScopeNotice;
import '../../data/realtime_runtime_settings.dart';

class PublicCreationScopeNotice extends StatelessWidget {
  const PublicCreationScopeNotice({super.key, required this.mode});
  final RealtimeProcessingMode mode;
  @override
  Widget build(BuildContext context) {
    if (configuredPublicDeploymentId.isEmpty || mode != RealtimeProcessingMode.online) return const SizedBox.shrink();
    return Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(
      Localizations.localeOf(context).languageCode == 'zh' ? publicCreationScopeNotice :
      'Public online currently uses fixed languages and the server-configured voice. Auto language/reversal, speaker attribution and term packs are not yet qualified.',
      style: Theme.of(context).textTheme.bodySmall));
  }
}
