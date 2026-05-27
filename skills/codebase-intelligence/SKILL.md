---
name: codebase-intelligence
description: >-
  Use for ALL code discovery, code search, code exploration, code review,
  code audit, and codebase understanding tasks. Activates when the user asks
  to find, search, trace, read, understand, review, check, audit, inspect,
  analyze, or examine code — including functions, classes, types, variables,
  file paths, callers, callees, data flow, architecture, performance, and
  security. Also triggers on Chinese keywords like "检查", "审查", "分析",
  "审计", "性能". Also triggers when the user says "how does X work",
  "what is Y", "explain", "look at", "show me", "find", "search" related to
  code. Use ONLY when the user needs to explore or navigate the codebase.
---

# Codebase Intelligence — 代码知识图谱搜索规则

本项目使用 `codebase-memory-mcp` 维护代码知识图谱。**你必须在代码搜索时严格遵守以下优先级规则。**

## 核心原则

**必须**优先使用 MCP 图工具进行代码发现，**仅在特定场景下**才回退到 grep/glob/file-search。

## 工具优先级（从高到低）

| 优先级 | 工具 | 适用场景 |
|--------|------|----------|
| 1 | `search_graph` | 查找函数、类、路由、变量定义；按名称/关键词搜索代码符号 |
| 2 | `trace_path` | 追踪函数的调用者（inbound）或被调用者（outbound）；分析数据流（data_flow 模式）；跨服务追踪（cross_service 模式） |
| 3 | `get_code_snippet` | 读取已找到的特定函数/类的源代码；浏览函数周围上下文 |
| 4 | `query_graph` | 复杂的多跳查询、聚合分析、跨服务交叉分析（需要 Cypher 查询） |
| 5 | `get_architecture` | 获取项目的高层架构概览——包、服务、依赖关系和项目结构 |
| 6 | grep/glob/file-search | 兜底方案，仅当上述工具不适用时才使用 |

## 工具选择决策树

```
用户想搜索代码
│
├─ 搜索函数/类/路由/变量定义？ → search_graph
│
├─ 搜索调用者/被调用者？ → trace_path
│  ├─ 只看谁调用了谁 → direction="calls"
│  ├─ 追踪参数值流向 → direction="data_flow"
│  └─ 跨 HTTP/RPC 服务追踪 → direction="cross_service"
│
├─ 需要读取特定函数的源代码？ → get_code_snippet
│  └─ 记得先用 search_graph 找到完整的 qualified_name
│
├─ 需要做复杂的跨模块分析？ → query_graph
│
├─ 需要整体架构概览？ → get_architecture
│
└─ 以上都不适用？ → 回退到 grep/glob
   ├─ 搜索文字字符串（错误消息、配置值、日志）
   ├─ 搜索非代码文件（Dockerfile、shell 脚本、配置文件）
   └─ MCP 图工具结果不足时补充搜索
```

## 反例（Anti-Patterns）

❌ **错误做法**：用户问「xxx 函数在哪里定义的」，直接使用 grep 搜函数名
✅ **正确做法**：先调 `search_graph(name_pattern=".*xxx.*")` 查函数定义

❌ **错误做法**：用户问「谁调用了这个函数」，直接 grep 搜函数名看引用
✅ **正确做法**：调 `trace_path(function_name="xxx", direction="inbound")`

❌ **错误做法**：不了解项目上下文就直接看文件内容
✅ **正确做法**：先调 `get_architecture()` 获取项目概览，再定位具体代码

❌ **错误做法**：用 grep 搜代码片段来"找出哪些文件包含了特定 API 调用"
✅ **正确做法**：用 `search_graph(query="api route handler")` 或 `trace_path` 来追踪调用链

## 回退到 grep/glob 的允许场景

- 搜索文字字符串字面量（错误消息、日志输出、配置 KEY）
- 搜索非代码文件（Dockerfile、shell 脚本、Markdown 文档、配置文件）
- MCP 图工具返回结果不足或不准确，需要补充搜索
- 需要搜索的文件不在代码知识图谱索引范围内

## 使用示例

### 查找类/函数定义

```
search_graph(name_pattern=".*OrderHandler.*")
```

### 追踪函数调用关系

```
trace_path(function_name="OrderHandler", direction="inbound")
trace_path(function_name="PaymentService.charge", direction="inbound", depth=3)
```

### 读取源代码

```
get_code_snippet(qualified_name="pkg/orders.OrderHandler")
```

### 获取项目架构

```
get_architecture()
```

### 检测变更影响

```
detect_changes(since="HEAD~3", depth=2)
```

## 关键提示

- 调用 `get_code_snippet` 前，务必先用 `search_graph` 找到准确的 `qualified_name`（完整的包路径+函数名）
- `trace_path` 的 `depth` 默认 3 层，分析影响面时建议增加到 5 层
- `include_tests=false` 默认过滤测试文件，如果需要分析测试代码需显式设为 `true`
- 当 results 不足时，使用 `limit` 参数增加返回数量
