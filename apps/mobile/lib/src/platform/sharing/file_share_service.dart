abstract interface class FileShareService {
  Future<String> saveExportFile(List<int> bytes, String filename);
  Future<void> shareFile(String path, {String? mimeType});
}
