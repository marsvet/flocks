# TDP/NDR Web 日志研判工作流

## 业务场景

对 NDR/TDP 上送的 HTTP 日志告警进行标准化研判（默认输入已为 HTTP 日志，无需类型判别）：收集情报 → 并行分析（测绘 / 漏洞 / 漏洞详情 / payload）→ 综合给出攻击判定与最终报告。其中**测绘 / 漏洞分析 / 漏洞详情 / 攻击 payload** 四步并行执行以缩短端到端时延。

## 流程结构

```
receive_alert  (告警解析)
   │
   ▼
prepare_intel  (查询 IP 威胁情报 + CVE 漏洞情报)
   │
   ▼
┌──────────────────  并行 4 节点  ──────────────────┐
│  survey            (测绘)                          │
│  cve_related       (从日志提取 CVE 编号)           │
│  cve_info          (展示 CVE 漏洞信息)             │
│  payload_analysis  (攻击 payload 分析)             │
└──────────────────────────────────────────────────┘
   │
   ▼
attack_analysis_result  (攻击分析结果，join 节点)
   │
   ▼
attack_verdict  (攻击判定：5 类标签)
   │
   ▼
report_title    (报告标题)
   │
   ▼
generate_report (输出最终 Markdown 报告)
```

## 节点详情

### 1. `receive_alert`
解析 NDR/TDP 告警 JSON，兼容顶层 `data` 数组与扁平结构。提取 `src_ip/dst_ip/sport/dport/protocol`、HTTP 请求/响应、URL、IOC 列表，以及预扫的 CVE/CNVD/CNNVD/XVE 编号。生成统一的 `log_text` 文本块供下游所有 LLM prompt 使用。

### 2. `prepare_intel`
并行块的预处理：
- 对外网 IP 调用 `threatbook_ip_query`（自动跳过 RFC1918 / 回环 / 保留地址）
- 对域名/URL 调用 `threatbook_domain_query` / `threatbook_url_query`
- 若 `receive_alert` 提取到 CVE，调用 `__mcp_vuln_query` 获取详情

输出 `intel_content` 与 `vuln_content` 文本块，供 `survey` 与 `cve_info` 的 LLM prompt 直接使用。

### 3-6. 并行节点

| 节点 | 职责 | 关键约束 |
|------|------|---------|
| `survey` | 总结 IP 情报中的空间测绘信息（标签 + 服务 + 应用资产） | 多 IP 以无序列表显示，无测绘信息则不列出 |
| `cve_related` | 仅从日志文本提取漏洞编号 | 不做任何推测，无编号则输出"日志中无关联漏洞情报" |
| `cve_info` | 基于 vuln_content 输出 CVE 基本信息 | 不输出修复建议、不带额外解释说明 |
| `payload_analysis` | 分析日志中是否包含攻击载荷及判定依据 | 不做攻击意图分析、不做攻击影响分析 |

4 个节点同时执行，各自独立产出结果。

### 7. `attack_analysis_result`（join）
`join: true` —— 等待 4 个并行节点全部完成。按"攻击成功 / 攻击失败 / 攻击 / 未知 / 安全"五分类标准进行长文本判定，输出"攻击状态 + 判定依据 + 详细分析"。同时把所有上游结果透传到下游。落盘到 `attack_analysis_result.md`。

### 8. `attack_verdict`
将上一节点的长文本归一化为 5 个标签之一：`attack_success` / `attack_failed` / `attack` / `unknown` / `benign`。LLM 输出做 token 容错。

### 9. `report_title`
基于攻击类型 + 判定结果生成 ≤30 字中文标题。对返回内容做引号/括号清理。LLM 失败时回退到 `<alert_type> - <verdict_cn>` 模板。

### 10. `generate_report`
汇总所有分析结果生成最终 Markdown 报告，9 个章节：执行摘要 → 日志类型 → 测绘 → 关联漏洞 → 漏洞详情 → payload → 攻击分析 → 威胁情报 → 原始日志。落盘到：
```
~/.flocks/workspace/outputs/<YYYY-MM-DD>/artifacts/final_report.md
```
报告标题包含攻击类型/结果，正文不包含时间戳。

## 输入参数

```json
{
  "alert_data": "TDP 告警 JSON（list / dict / 嵌套 data 结构均支持）"
}
```

## 输出参数

| 字段 | 类型 | 说明 |
|------|------|------|
| `final_report` | string | 完整 Markdown 报告 |
| `report_path` | string | 报告文件路径 |
| `report_title` | string | 报告标题 |
| `attack_verdict` | enum | `attack_success` / `attack_failed` / `attack` / `unknown` / `benign` |
| `risk_level` | enum | `High` / `Medium` / `Low` |

## 工程要点

- **并行扇出/扇入**：`prepare_intel` 是唯一 fan-out 起点；`attack_analysis_result` 用 `join: true` 作为唯一 fan-in 汇聚点，符合 flocks workflow 引擎的 lint 要求。
- **LLM 推理块清洗**：所有 LLM 节点都会用 `_strip_think()` 去除 `<think>...</think>` 推理块，避免模型内部思考过程污染输出。
- **LLM 容错**：所有调用 `llm.ask` 的节点都对返回结果做了正则提取与回退处理，单一 LLM 输出格式偏差不会让整个工作流失败。
- **节点超时**：`metadata.node_timeout_s = 600`，留给最慢的 LLM 推理足够时间。
- **报告落盘**：使用 `WorkspaceManager.get_workspace_dir()` 解析输出根目录，所有产物统一落到 flocks 工作区下的 `outputs/<date>/artifacts/`。
