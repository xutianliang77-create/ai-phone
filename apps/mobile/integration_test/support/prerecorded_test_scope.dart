import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:translation_mobile/src/platform/asr/apple_speech_prerecorded_input.dart';

/// Test-only process scope. Production main.dart never imports this library.
/// Installed system/model assets are read by native providers; business files
/// go to app-created result directories, never to the read-only input folder.
class PrerecordedTestScope {
  PrerecordedTestScope._(this.root, this._previousPaths, this._previousHttp);
  static PrerecordedTestScope? _active;
  final Directory root;
  final PathProviderPlatform _previousPaths;
  final HttpOverrides? _previousHttp;
  late final _ScopedPaths _paths = _ScopedPaths(root);
  late final _NoNetwork _http = _NoNetwork();
  bool _closed = false;
  int get blockedNetworkAttempts => _http.attempts;

  static Future<PrerecordedTestScope> create(
      {Directory? supportDirectory}) async {
    if (_active != null) {
      throw StateError('A prerecorded test scope is already active');
    }
    final support = supportDirectory ?? await getApplicationSupportDirectory();
    final base = await _ownedChild(support, 'wujie-s2-prerecorded');
    final results = await _ownedChild(base, 'results');
    final root = await results.createTemp('run-');
    final scope = PrerecordedTestScope._(
        root, PathProviderPlatform.instance, HttpOverrides.current);
    _active = scope;
    PathProviderPlatform.instance = scope._paths;
    HttpOverrides.global = scope._http;
    return scope;
  }

  static Future<AppleSpeechPrerecordedInput> readStagedInput({
    required String name,
    required String sha256,
    Directory? supportDirectory,
  }) async {
    if (!RegExp(r'^[A-Za-z0-9_-]{1,80}$').hasMatch(name)) {
      throw ArgumentError('Invalid fixture name');
    }
    final support = supportDirectory ?? await getApplicationSupportDirectory();
    final base = await _existingChild(support, 'wujie-s2-prerecorded');
    final inputs = await _existingChild(base, 'inputs');
    final file = File('${inputs.path}/$name.wav');
    if (await FileSystemEntity.type(file.path, followLinks: false) !=
        FileSystemEntityType.file) {
      throw StateError('The allowlisted WAV input has not been staged');
    }
    final size = await file.length();
    if (size < 44 || size > 2000000) {
      throw StateError('Input exceeds bounded WAV size');
    }
    return AppleSpeechPrerecordedInput(
        wavBytes: await file.readAsBytes(), sha256: sha256);
  }

  Future<File> writeReport(String name, String contents) async {
    if (_closed || !RegExp(r'^[A-Za-z0-9_-]+\.json$').hasMatch(name)) {
      throw StateError('Invalid test report destination');
    }
    final file = File('${root.path}/$name');
    await file.writeAsString(contents, flush: true);
    return file;
  }

  /// Call only after widgets/controllers and their async cleanup have drained.
  void close() {
    if (_closed) return;
    if (!identical(_active, this) ||
        !identical(PathProviderPlatform.instance, _paths)) {
      throw StateError('Test scope ownership changed');
    }
    _closed = true;
    PathProviderPlatform.instance = _previousPaths;
    HttpOverrides.global = _previousHttp;
    _active = null;
    // Evidence stays available. Do not delete user or prior test directories.
  }

  static Future<Directory> _existingChild(Directory parent, String name) async {
    final child = Directory('${await parent.resolveSymbolicLinks()}/$name');
    if (await FileSystemEntity.type(child.path, followLinks: false) !=
        FileSystemEntityType.directory) {
      throw StateError('Missing or symlinked test directory');
    }
    return child;
  }

  static Future<Directory> _ownedChild(Directory parent, String name) async {
    final child = Directory('${await parent.resolveSymbolicLinks()}/$name');
    final kind = await FileSystemEntity.type(child.path, followLinks: false);
    if (kind == FileSystemEntityType.notFound) return child.create();
    if (kind != FileSystemEntityType.directory) {
      throw StateError('Unsafe test directory');
    }
    return child;
  }
}

class _ScopedPaths extends PathProviderPlatform {
  _ScopedPaths(this.root);
  final Directory root;
  Future<String> _path(String name) async =>
      (await Directory('${root.path}/$name').create()).path;
  @override
  Future<String?> getApplicationSupportPath() => _path('support');
  @override
  Future<String?> getApplicationDocumentsPath() => _path('documents');
  @override
  Future<String?> getTemporaryPath() => _path('temporary');
  @override
  Future<String?> getLibraryPath() => _path('library');
  @override
  Future<String?> getApplicationCachePath() => _path('cache');
  @override
  Future<String?> getDownloadsPath() => _path('downloads');
  @override
  Future<String?> getExternalStoragePath() async => null;
  @override
  Future<List<String>?> getExternalCachePaths() async => [];
  @override
  Future<List<String>?> getExternalStoragePaths(
          {StorageDirectory? type}) async =>
      [];
}

class _NoNetwork extends HttpOverrides {
  int attempts = 0;
  @override
  HttpClient createHttpClient(SecurityContext? context) =>
      _DeniedHttpClient(() {
        attempts++;
      });
}

class _DeniedHttpClient implements HttpClient {
  _DeniedHttpClient(this.onAttempt);
  final void Function() onAttempt;
  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async {
    onAttempt();
    throw const SocketException(
        'Business network is disabled in prerecorded validation');
  }

  @override
  void close({bool force = false}) {}
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
