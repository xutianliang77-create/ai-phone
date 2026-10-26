import 'package:flutter/material.dart';
import '../../data/local_session_store.dart';
import '../../data/session_history_models.dart';
import '../../../../platform/sharing/local_file_share_service.dart';
import 'dart:convert';

/// Explicit, read-only access to the old unowned local file. Never rebinds or
/// migrates existing bytes to the newly signed-in account.
class LegacyLocalHistoryPage extends StatelessWidget {
  const LegacyLocalHistoryPage({super.key});
  @override
  Widget build(BuildContext context) {
    final store = LocalSessionStore();
    return Scaffold(
      appBar: AppBar(title: const Text('本机旧记录（未绑定账号）')),
      body: FutureBuilder<List<SessionListItem>>(
        future: store.listSessions(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Center(child: Text('正在读取本机旧记录；文件保持原样。'));
          }
          return ListView(
            children: [
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('这些记录属于此手机的旧版数据，不会自动归到当前账号。此入口仅查看和导出，不修改旧文件。'),
              ),
              for (final s in snapshot.requireData)
                ListTile(
                  title: Text(s.title ?? s.sessionId),
                  subtitle: Text(s.createdAt.toLocal().toString()),
                  onTap: () async {
                    final detail = await store.getSession(s.sessionId);
                    if (!context.mounted) return;
                    await showDialog<void>(
                      context: context,
                      builder: (c) => AlertDialog(
                        title: const Text('本机旧记录'),
                        content: SingleChildScrollView(
                          child: SelectableText(
                            detail.segments
                                .map(
                                  (v) => '${v.sourceText}\n${v.translatedText}',
                                )
                                .join('\n\n'),
                          ),
                        ),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(c),
                            child: const Text('关闭'),
                          ),
                          TextButton(
                            onPressed: () async {
                              final e = await store.exportSession(s.sessionId),
                                  sharing = LocalFileShareService();
                              final path = await sharing.saveExportFile(
                                utf8.encode(e.content),
                                e.filename,
                              );
                              await sharing.shareFile(
                                path,
                                mimeType: e.mimeType,
                              );
                            },
                            child: const Text('导出'),
                          ),
                        ],
                      ),
                    );
                  },
                ),
            ],
          );
        },
      ),
    );
  }
}
