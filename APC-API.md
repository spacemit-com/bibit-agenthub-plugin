# APC\-API接口文档

# APC \(Agent Power Cloud\) 对外接口文档

## 概述

APC 是 SpacemiT 的资源分发平台，支持开发者提交和分发 skill、plugin、mcp、agent 等资源。

**Base URL**：

- 测试环境：`https://developer.bianbu.xyz/api-server/apc/api/v1`

- 生产环境：`https://developer.spacemit.com/api-server/apc/api/v1`

---

## 一、资源查询接口（公开，无需认证）

### 1\.1 获取目录版本信息

获取当前最新资源目录的版本摘要，客户端可用此判断本地缓存是否需要更新。

**接口**：`GET /resources/version`

**响应示例**：

```JSON
{
  "schema_version": 1,
  "catalog_sha256": "7c08f6a113aef9a419b010540cf298b0772c20691d319c34a8331068621dfdea",
  "catalog_size": 643
}
```

**字段说明**：

|字段|类型|说明|
|---|---|---|
|`schema_version`|int|目录 Schema 版本，目前固定为 1|
|`catalog_sha256`|string|目录文件内容的 SHA\-256 哈希（64 位小写十六进制）|
|`catalog_size`|long|目录文件大小（字节）|

**异常响应**：

- `500` \+ ApcException `NOT_FOUND`：当前没有可用的目录版本

- `500` \+ ApcException `INTERNAL_ERROR`：服务器内部错误

---

### 1\.2 获取完整资源目录

重定向到 CDN 上的最新目录 JSON 文件。

**接口**：`GET /resources`

**响应**：

- 成功：`302 Found`，`Location` 头指向 CDN 目录文件 URL

- 无目录：`404 Not Found`（无响应体）

- 失败：`500 Internal Server Error`（无响应体）

**使用方式**：

客户端应跟随重定向下载 JSON 文件，文件格式如下（`CatalogService` 生成）：

```JSON
{
  "skills": {
    "items": [
      {
        "name": "code-review-helper",
        "schema_version": 1,
        "version": "v1.0.0",
        "description": "代码审查助手",
        "message": "首次发布",
        "content_type": "application/gzip",
        "content_size": 160,
        "content_md5": "0274020ce87b4b9c067786d8fdf342ef",
        "published_at": "2026-09-01T14:22:31.932495",
        "download_url": "https://cdn-resource.spacemit.com/file/apc/resource/code-review-helper-1-v1.0.0.tar.gz"
      }
    ]
  },
  "plugins": { "items": [] },
  "mcps": { "items": [] },
  "agents": { "items": [] }
}
```

**目录结构字段说明**：

|字段|类型|说明|
|---|---|---|
|`skills/plugins/mcps/agents`|object|按资源类型分组，每组包含 `items` 数组|
|`items[].name`|string|资源名称|
|`items[].schema_version`|int|Schema 版本|
|`items[].version`|string|最新版本号（格式 `vMAJOR.MINOR.PATCH`）|
|`items[].description`|string|资源描述|
|`items[].message`|string|发布说明|
|`items[].content_type`|string|文件类型，固定为 `application/gzip`|
|`items[].content_size`|long|文件大小（字节）|
|`items[].content_md5`|string|文件 MD5|
|`items[].published_at`|string|发布时间（ISO 8601）|
|`items[].download_url`|string|文件下载地址（CDN URL）|

> 说明：每种类型只保留每个 `name` 的最新版本，客户端如需历史版本请使用接口 1\.3。

---

### 1\.3 下载指定版本资源文件

重定向到该版本资源文件的 CDN 地址。

**接口**：`GET /resources/{type}/{name}/versions/{version}/content`

**路径参数**：

|参数|说明|
|---|---|
|`type`|资源类型，枚举：`skill`、`plugin`、`mcp`、`agent`|
|`name`|资源名称|
|`version`|版本号，格式 `vMAJOR.MINOR.PATCH`（如 `v1.0.0`）|

**请求示例**：

```Plaintext
GET /apc/api/v1/resources/skill/code-review-helper/versions/v1.0.0/content
```

**响应**：

- 成功：`302 Found`，`Location` 头指向 CDN 文件下载地址

- 类型非法：`400 Bad Request`（无响应体）

- 资源不存在：`404 Not Found`（无响应体）

- 资源已下架：`410 Gone`（无响应体）

- 服务器错误：`500 Internal Server Error`（无响应体）

**说明**：

- `status = yanked` 的资源返回 `410 Gone`

- `status = published` 的资源正常重定向

---

### 1\.4 获取全部标签

返回全部已启用的标签定义（`apc_tag` 表），供客户端展示标签、做标签过滤。

**接口**：`GET /tags`

**认证**：无需认证（公开接口）

**响应示例**：

```JSON
{
  "items": [
    {
      "id": "tag_01M1DS53ZE4H059CWQ9J",
      "tag_key": "featured",
      "tag_name": "精选",
      "tag_name_en": "Featured",
      "tag_color": "red",
      "description": "首页精选资源",
      "sort": 1
    },
    {
      "id": "tag_01M1DS53ZE4H059CWQ9K",
      "tag_key": "official",
      "tag_name": "官方",
      "tag_name_en": "Official",
      "tag_color": "blue",
      "description": "官方出品资源",
      "sort": 2
    }
  ]
}
```

**items 字段说明**：

|字段|类型|说明|
|---|---|---|
|`id`|string|标签 ID|
|`tag_key`|string|标签键（`featured`、`hot`、`official` 等，唯一标识）|
|`tag_name`|string|标签名称（中文）|
|`tag_name_en`|string|标签名称（英文）|
|`tag_color`|string|标签颜色|
|`description`|string|标签说明|
|`sort`|int|排序值，越小越靠前|

**说明**：

- 只返回 `enable = 'Y'`（已启用）的标签，禁用标签不返回。

- 按 `sort` 升序、`id` 升序排序，与资源目录中 `tags` 字段的顺序一致。

**异常响应**：

- `500` \+ ApcException `INTERNAL_ERROR`：服务器内部错误

---

## 二、资源提交接口（需要 API Key 认证）

### 认证说明

所有提交接口需在 HTTP Header 中携带 API Key：

```Plaintext
Authorization: Bearer <official-api-key>
```

认证由 `ApcAuthInterceptor` 拦截器处理，成功后会在 request attribute 中设置以下字段，Controller 通过 `@RequestAttribute` 读取：

- `userId`：用户 ID

- `username`：用户名

- `userEmail`：用户邮箱

- `apiKeyId`：API Key ID

---

### 2\.1 提交资源

提交资源元数据和文件内容，一次性完成。

**接口**：`POST /submissions`

**请求 Headers**：

```Plaintext
Content-Type: multipart/form-data
Authorization: Bearer <official-api-key>
```

**请求 Parts**：

|Part 名称|类型|是否必需|说明|
|---|---|---|---|
|`metadata`|JSON 字符串|必需|资源元数据（见下方字段说明）|
|`content`|文件（二进制）|非 mcp 类型必需；mcp 类型禁止传|资源文件|

**metadata JSON 字段说明**：

|字段|必需|类型|说明|
|---|---|---|---|
|`type`|是|string|资源类型：`skill`、`plugin`、`mcp`、`agent`|
|`name`|是|string|资源名称，kebab\-case 格式（小写字母、数字、连字符）|
|`version`|是|string|版本号，格式 `vMAJOR.MINOR.PATCH`（如 `v1.0.0`）|
|`description`|否|string|资源描述|
|`message`|否|string|本次发布说明|
|`schema_version`|是|int|Schema 版本，目前固定为 1|
|`content_md5`|skill/plugin/agent 必需；mcp 可选|string|文件 MD5 校验值（客户端预计算，服务端校验）|
|`definition`|**mcp 类型必需**|object|MCP 运行时定义（transport/command/args），仅 `type=mcp` 时有效|

**非 MCP 类型（skill / plugin / agent）提交示例**：

```Bash
curl -X POST .../submissions \
  -H "Authorization: Bearer your-key" \
  -F 'metadata={"type":"skill","name":"code-review-helper","version":"v1.0.0","description":"代码审查助手","message":"首次发布","schema_version":1,"content_md5":"0274020ce87b4b9c067786d8fdf342ef"}' \
  -F "content=@code-review-helper-v1.0.0.tar.gz"
```

**MCP 类型提交示例**（无需上传 content 文件，整个 metadata JSON 就是资源内容）：

```Bash
curl -X POST .../submissions \
  -H "Authorization: Bearer your-key" \
  -F 'metadata={
    "schema_version": 1,
    "type": "mcp",
    "name": "filesystem",
    "version": "v1.0.0",
    "description": "提供受限的文件系统访问能力",
    "definition": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"]
    }
  }'
```

MCP 提交时，服务端将整个 metadata JSON（经 RFC 8785 JCS 规范化）序列化为 `.json` 文件上传 OSS，作为该资源的下载内容。

**OSS 存储路径规范**：

```Plaintext
file/apc/resource/{type}/{name}-{schemaVersion}-{version}{extension}
```

示例：

- `file/apc/resource/skill/code-review-helper-1-v1.0.0.tar.gz`

- `file/apc/resource/mcp/filesystem-1-v1.0.0.json`

- `file/apc/resource/plugin/my-plugin-1-v2.1.3.tar.gz`

**content 文件格式（非 MCP 类型）**：

|资源类型|文件格式|
|---|---|
|`skill`|`.tar.gz` 压缩包|
|`plugin`|`.tar.gz` 压缩包|
|`agent`|`.tar.gz` 压缩包|

**文件大小限制**：最大 100MB（由 Spring multipart 配置控制）

**成功响应**：`202 Accepted`

```JSON
{
  "submission_id": "sub_01M1DS53ZE4H059CWQ9J",
  "status": "received",
  "status_url": "/apc/api/v1/submissions/sub_01M1DS53ZE4H059CWQ9J"
}
```

**字段说明**：

|字段|说明|
|---|---|
|`submission_id`|提交 ID，格式 `sub_` 前缀 \+ ULID，用于后续查询|
|`status`|初始状态，固定为 `received`|
|`status_url`|查询该提交状态的 URL 路径|

**状态流转**：

```Plaintext
received → validating → validation_failed（终态）
                     ↓
              review_pending → rejected（终态）
                            ↓
                         approved → publishing → published（终态）
                                              ↓
                                       publish_failed（可重试）
```

**异常响应**：

所有异常由 `ApcExceptionHandler` 统一处理，格式为：

```JSON
{
  "code": "INVALID_VERSION",
  "message": "新版本 v0.9.0 必须大于已发布的最高版本 v1.0.0"
}
```

**错误码**：

|错误码|HTTP 状态|说明|
|---|---|---|
|`UNAUTHORIZED`|401|API Key 无效或未提供|
|`INVALID_PARAM`|400|请求参数不合法（类型、名称、版本格式错误）|
|`MD5_MISMATCH`|400|文件 MD5 与 metadata 中声明的不一致|
|`VERSION_PUBLISHED`|409|该版本已发布，不可重复提交|
|`VERSION_NOT_INCREMENTED`|400|新版本号必须大于已发布的最高版本|
|`RESOURCE_IN_PROGRESS`|409|该资源已有其他版本正在处理中（处于 active 状态）|

---

### 2\.2 查询提交详情

查询指定提交的完整详情，包括状态和时间线。

**接口**：`GET /submissions/{submissionId}`

**路径参数**：

|参数|说明|
|---|---|
|`submissionId`|提交 ID（从 2\.1 接口返回）|

**请求 Headers**：

```Plaintext
Authorization: Bearer <official-api-key>
```

**成功响应**：`200 OK`

```JSON
{
  "submission_id": "sub_01M1DS53ZE4H059CWQ9J",
  "type": "skill",
  "name": "code-review-helper",
  "version": "v1.0.0",
  "description": "代码审查助手",
  "message": "首次发布",
  "status": "published",
  "content_available": false,
  "validation_errors": [],
  "review_comment": "",
  "published_version": "v1.0.0",
  "created_at": "2026-09-01T14:05:27",
  "updated_at": "2026-09-01T14:22:32",
  "timeline": [
    {
      "event_id": "log_01M1DS53ZE4H059ABC01",
      "event_type": "received",
      "status_from": "",
      "status_to": "received",
      "timestamp": "2026-09-01T14:05:27",
      "message": "Submission received"
    },
    {
      "event_id": "log_01M1DS53ZE4H059ABC02",
      "event_type": "approved",
      "status_from": "review_pending",
      "status_to": "approved",
      "timestamp": "2026-09-01T14:22:31",
      "message": "Review approved"
    },
    {
      "event_id": "log_01M1DS53ZE4H059ABC03",
      "event_type": "published",
      "status_from": "publishing",
      "status_to": "published",
      "timestamp": "2026-09-01T14:22:32",
      "message": "Resource published successfully"
    }
  ]
}
```

**字段说明**：

|字段|说明|
|---|---|
|`submission_id`|提交 ID|
|`type`|资源类型|
|`name`|资源名称|
|`version`|版本号|
|`description`|资源描述|
|`message`|发布说明|
|`status`|当前状态（见状态流转图）|
|`content_available`|原始文件是否仍可获取（终态后为 false）|
|`validation_errors`|校验错误列表（校验失败时非空）|
|`review_comment`|审核意见（被拒绝时非空，其余为空字符串）|
|`published_version`|已发布版本号（发布成功后有值，否则为空字符串）|
|`created_at`|创建时间（ISO 8601）|
|`updated_at`|最后更新时间（ISO 8601）|
|`timeline`|状态变更时间线（按时间升序）|
|`timeline[].event_id`|事件 ID|
|`timeline[].event_type`|事件类型（received/validated/approved/rejected/published/publish\_failed 等）|
|`timeline[].status_from`|前一状态（初始事件为空字符串）|
|`timeline[].status_to`|变更后状态|
|`timeline[].timestamp`|事件时间|
|`timeline[].message`|事件说明（公开信息，不含内网链接或审核者信息）|

**异常响应**：

|错误码|HTTP 状态|说明|
|---|---|---|
|`UNAUTHORIZED`|401|API Key 无效|
|`SUBMISSION_NOT_FOUND`|404|提交不存在|
|`ACCESS_DENIED`|403|提交不属于当前用户|

---

### 2\.3 查询我的提交列表

查询当前用户名下所有处于 **active 状态**的提交记录，按创建时间倒序，最多返回 20 条。

**接口**：`GET /submissions`

**请求 Headers**：

```Plaintext
Authorization: Bearer <official-api-key>
```

**请求参数**：

|参数|必需|说明|
|---|---|---|
|`type`|否|按资源类型过滤：`skill`、`plugin`、`mcp`、`agent`|
|`status`|否|按状态精确过滤|
|`name`|否|按资源名称精确过滤|

> 注意：本接口不支持分页，固定返回最近 20 条 active 记录（`received`、`validating`、`review_pending`、`approved`、`publishing`、`publish_failed` 状态）。终态记录（`published`、`rejected`、`validation_failed`）不在返回范围内。

**成功响应**：`200 OK`

```JSON
{
  "items": [
    {
      "submission_id": "sub_01M1DS53ZE4H059CWQ9J",
      "type": "skill",
      "name": "code-review-helper",
      "version": "v1.0.0",
      "status": "review_pending",
      "created_at": "2026-09-01T14:05:27"
    }
  ]
}
```

**items 字段说明**：

|字段|说明|
|---|---|
|`submission_id`|提交 ID|
|`type`|资源类型|
|`name`|资源名称|
|`version`|版本号|
|`status`|当前状态|
|`created_at`|创建时间|

**异常响应**：

|错误码|HTTP 状态|说明|
|---|---|---|
|`UNAUTHORIZED`|401|API Key 无效|

---

## 三、常见场景示例

### 场景 1：提交新资源

```Bash
# 提交 metadata + 文件
curl -X POST https://developer.bianbu.xyz/api-server/apc/api/v1/submissions \
  -H "Authorization: Bearer your-api-key" \
  -F 'metadata={"type":"skill","name":"code-review-helper","version":"v1.0.0","description":"代码审查助手","message":"首次发布","schema_version":1,"content_md5":"0274020ce87b4b9c067786d8fdf342ef"}' \
  -F "content=@code-review-helper-v1.0.0.tar.gz"

# 响应 202 Accepted
{
  "submission_id": "sub_01M1DS53ZE4H059CWQ9J",
  "status": "received",
  "status_url": "/apc/api/v1/submissions/sub_01M1DS53ZE4H059CWQ9J"
}
```

### 场景 2：轮询提交状态

```Bash
curl https://developer.bianbu.xyz/api-server/apc/api/v1/submissions/sub_01M1DS53ZE4H059CWQ9J \
  -H "Authorization: Bearer your-api-key"
```

### 场景 3：检查目录是否更新并下载

```Bash
# 1. 获取版本摘要
curl https://developer.bianbu.xyz/api-server/apc/api/v1/resources/version

# 2. 若 catalog_sha256 与本地不同，下载最新目录（跟随重定向）
curl -L https://developer.bianbu.xyz/api-server/apc/api/v1/resources -o catalog.json

# 3. 按目录下载具体资源（跟随重定向）
curl -L "https://developer.bianbu.xyz/api-server/apc/api/v1/resources/skill/code-review-helper/versions/v1.0.0/content" \
  -o code-review-helper-v1.0.0.tar.gz
```

---

## 四、错误响应格式

所有错误由 `ApcExceptionHandler` 统一返回 RFC 7807 格式，`Content-Type: application/problem+json`：

```JSON
{
  "title": "Resource conflict",
  "status": 409,
  "code": "RESOURCE_IN_PROGRESS",
  "detail": "该资源已有版本 v1.0.0 正在处理中，请等待完成后再提交新版本，submission_id: sub_01M1G3MKA4Z1392YASY4",
  "instance": "/apc/api/v1/submissions",
  "trace_id": "tr_01M1GXKP5967X347CKJX",
  "errors": [
    {
      "code": "RESOURCE_IN_PROGRESS",
      "message": "该资源已有版本 v1.0.0 正在处理中，请等待完成后再提交新版本，submission_id: sub_01M1G3MKA4Z1392YASY4"
    }
  ]
}
```

**字段说明**：

|字段|说明|
|---|---|
|`title`|问题类型的英文简短标题|
|`status`|HTTP 状态码|
|`code`|稳定的错误码字符串，程序逻辑应依赖此字段|
|`detail`|人类可读的详细错误描述|
|`instance`|发生错误的请求路径|
|`trace_id`|追踪 ID，格式 `tr_` 前缀 \+ ULID，排查问题时提供给技术支持|
|`errors`|错误详情列表（校验类错误时可能包含多个条目）|
|`errors[].code`|子错误码|
|`errors[].path`|出错的字段路径（校验错误时有值）|
|`errors[].message`|子错误描述|

**各异常类型对应的 title 和 status**：

|异常类|title|status|
|---|---|---|
|`ValidationException`|Resource validation failed|422|
|`ResourceConflictException`|Resource conflict|409|
|`IdempotencyConflictException`|Idempotency conflict|409|
|`ResourceNotFoundException`|Resource not found|404|
|`ApcException`（通用）|Business error|400|
|未捕获异常|Internal server error|500|

**完整错误码列表**：

|错误码|所属异常|说明|
|---|---|---|
|`ALREADY_PUBLISHED`|ResourceConflictException|该版本已发布|
|`RESOURCE_VERSION_CONFLICT`|ResourceConflictException|新版本必须高于已发布的最高版本|
|`RESOURCE_SUBMISSION_IN_PROGRESS`|ResourceConflictException|该资源有正在进行中的提交|
|`SAME_CONTENT_REJECTED`|ResourceConflictException|相同内容已被拒绝，请修改后重新提交|
|`IDEMPOTENCY_CONFLICT`|IdempotencyConflictException|相同幂等键但请求内容不一致|
|`RESOURCE_NOT_FOUND`|ResourceNotFoundException|资源不存在|
|`VALIDATION_ERROR`|ValidationException|校验失败（通用）|
|`INTERNAL_ERROR`|未捕获异常|系统内部错误，detail 不暴露内部细节|

> 资源查询接口（`/resources/*`）的部分非 2xx 响应无响应体，直接通过 HTTP 状态码判断（见各接口说明）。

---

**文档版本**：v1\.1
**最后更新**：2026\-09\-02
**来源**：`ResourceController.java`、`SubmissionController.java`

