import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import 'file_share_service.dart';

class LocalFileShareService implements FileShareService {
  @override
  Future<String> saveExportFile(List<int> bytes, String filename) async {
    final directory = await getTemporaryDirectory();
    final file = File('${directory.path}/$filename');
    await file.writeAsBytes(bytes, flush: true);
    return file.path;
  }

  @override
  Future<void> shareFile(String path, {String? mimeType}) async {
    await SharePlus.instance.share(
      ShareParams(files: <XFile>[XFile(path, mimeType: mimeType)]),
    );
  }
}
