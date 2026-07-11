class TestSample {
  TestSample({
    required this.id,
    required this.group,
    required this.priority,
    required this.language,
    required this.targetLanguage,
    required this.text,
    required this.expectedTranslation,
  });

  final String id;
  final String group;
  final String priority;
  final String language;
  final String targetLanguage;
  final String text;
  final String expectedTranslation;

  factory TestSample.fromJson(Map<String, dynamic> json) {
    return TestSample(
      id: json['id'] as String,
      group: json['group'] as String,
      priority: json['priority'] as String,
      language: json['language'] as String,
      targetLanguage: json['targetLanguage'] as String,
      text: json['text'] as String,
      expectedTranslation: json['expectedTranslation'] as String,
    );
  }
}
