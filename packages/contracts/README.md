# Communication Contract v1

`fixtures/communication-v1` 是 Node、Flutter 和 Python 的跨语言 golden 真值。
修改 envelope 时必须保持以下规则：

- `contractVersion=1` 只允许新增可选字段；重命名、删除、改类型必须升级版本。
- ID 是 1–160 字符的 opaque string，不得把 LiveKit SDK 类型泄漏到领域合同。
- command 使用 `commandId + expectedVersion + idempotencyKey`；event 使用
  `eventId + eventVersion + aggregateVersion + sequence + idempotencyKey`。
- fixture 不得包含手机号、token、真实 provider ID 或其他个人/生产数据。

验收命令（本批仅补代码，尚未执行）：

```bash
npm run test -w @translation/contracts
npm run test:communication-contract-python
npm run test:communication-contract-flutter
```
