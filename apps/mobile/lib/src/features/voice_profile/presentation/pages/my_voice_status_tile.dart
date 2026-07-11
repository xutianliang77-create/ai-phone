import 'package:flutter/material.dart';

class MyVoiceStatusTile extends StatelessWidget {
  const MyVoiceStatusTile({
    required this.icon,
    required this.title,
    required this.value,
    super.key,
  });

  final IconData icon;
  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon),
      title: Text(title),
      subtitle: Text(value),
      contentPadding: const EdgeInsets.symmetric(vertical: 4),
    );
  }
}
