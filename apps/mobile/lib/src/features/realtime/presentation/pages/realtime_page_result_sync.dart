part of 'realtime_page.dart';

Widget _resultSyncActions(_RealtimePageState state) {
  final controller = state.controller, chinese = state.context.l10n.isChinese;
  return Wrap(spacing: 8, children: [
    if (!controller.resultSyncEnabled && !controller.resultSyncRevocationPending)
      TextButton(
          onPressed: controller.resultSyncBusy
              ? null
              : () async {
                  final allowed = await confirmResultTextSync(state.context,
                      destination: controller.resultSyncDestination);
                  if (allowed &&
                      state.mounted &&
                      identical(controller, state.controller) &&
                      controller.resultSyncAvailable) {
                    await controller.setResultSyncConsent(true);
                  }
                },
          child: Text(chinese ? '允许本会话同步' : 'Allow session sync')),
    if (controller.resultSyncEnabled) ...[
      TextButton(
          onPressed:
              controller.resultSyncBusy ? null : controller.synchronizeResults,
          child: Text(chinese ? '同步一次' : 'Sync once')),
      TextButton(
          onPressed: () => controller.setResultSyncConsent(false),
          child: Text(chinese ? '撤销同步' : 'Revoke sync')),
    ],
    if (controller.resultSyncRevocationPending)
      TextButton(onPressed: controller.resultSyncBusy ? null : () => controller.setResultSyncConsent(false),
        child: Text(chinese ? '重试撤销' : 'Retry revocation')),
  ]);
}
