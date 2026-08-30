# Enterprise release materials

`release-materials.example.json` 仅描述 manifest 结构，始终保持 `pending/draft`，不能作为发布证据。
正式候选在干净的候选 commit 上复制为不提交的 `release-materials.json`，填写真实镜像摘要、
文件 SHA-256、A0–A3/H1–H3 证据及六项审批，然后运行：

```bash
npm run check:enterprise-release-materials -- \
  --file release/enterprise/release-materials.json \
  --image-digest sha256:<candidate-image-digest>
```

生产环境同时设置 `ENTERPRISE_RELEASE_MATERIALS_FILE`、
`ENTERPRISE_RELEASE_CANDIDATE_COMMIT` 和 `ENTERPRISE_RELEASE_IMAGE_DIGEST`。
checker 通过只证明材料和引用完整；它不生成或替代验收证据。
