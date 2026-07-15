import 'package:flutter/material.dart';

class AiCallingAgentForm extends StatelessWidget {
  const AiCallingAgentForm({
    required this.scenario,
    required this.targetNameController,
    required this.targetPhoneController,
    required this.objectiveController,
    required this.disclosureConfirmed,
    required this.busy,
    required this.onScenarioChanged,
    required this.onDisclosureChanged,
    required this.onCreateDraft,
    super.key,
  });

  final String scenario;
  final TextEditingController targetNameController;
  final TextEditingController targetPhoneController;
  final TextEditingController objectiveController;
  final bool disclosureConfirmed;
  final bool busy;
  final ValueChanged<String> onScenarioChanged;
  final ValueChanged<bool> onDisclosureChanged;
  final VoidCallback onCreateDraft;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        DropdownButtonFormField<String>(
          initialValue: scenario,
          decoration: const InputDecoration(labelText: '场景'),
          items: const <DropdownMenuItem<String>>[
            DropdownMenuItem(value: 'booking', child: Text('预约')),
            DropdownMenuItem(value: 'customer_support', child: Text('客服查询')),
            DropdownMenuItem(value: 'business_inquiry', child: Text('外贸询价')),
            DropdownMenuItem(value: 'custom', child: Text('自定义')),
          ],
          onChanged: busy ? null : (value) => onScenarioChanged(value!),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: targetNameController,
          decoration: const InputDecoration(labelText: '联系人或机构'),
          textInputAction: TextInputAction.next,
        ),
        const SizedBox(height: 12),
        TextField(
          controller: targetPhoneController,
          decoration: const InputDecoration(labelText: '电话号码'),
          keyboardType: TextInputType.phone,
          textInputAction: TextInputAction.next,
        ),
        const SizedBox(height: 12),
        TextField(
          controller: objectiveController,
          decoration: const InputDecoration(
            labelText: '本次电话目标',
            hintText: '例如：预约明天下午的牙医复诊',
          ),
          maxLines: 3,
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: disclosureConfirmed,
          onChanged:
              busy ? null : (value) => onDisclosureChanged(value ?? false),
          title: const Text('接通后先告知对方正在与 AI 通话'),
          subtitle: const Text('确认后才可进入拨号队列'),
          controlAffinity: ListTileControlAffinity.leading,
        ),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: busy ? null : onCreateDraft,
            icon: const Icon(Icons.description_outlined),
            label: const Text('生成话术草稿'),
          ),
        ),
      ],
    );
  }
}
