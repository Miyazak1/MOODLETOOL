# OSSD 课程资源门户建设方案

更新时间：2026-07-17

## 1. 项目目标

本项目要建设一个面向不熟悉 OSSD 课程体系教师的备课资源门户。网站的核心目的不是宣传展示，而是帮助教师快速理解一门课的教学结构，并按 Unit 和 Lesson 找到可直接用于备课、授课、布置作业和复习评估的材料。

以当前已整理的 ENG3U 为第一门样板课程，网站需要结构化呈现：

- 课程大纲 / course outline
- Introduction / 课程说明
- Unit plan
- Lesson plan
- iSpring 课件模块
- 教材、文学作品和阅读材料
- 讲义、作业、PDF、DOCX、视频、H5P、Quiz / Answer 等辅助资源

其中 iSpring 模块只做页面展示或跳转播放，不作为普通下载文件；其他文件原则上以下载资源的方式呈现在对应 Unit / Lesson 中。

## 2. 核心信息架构

网站必须采用 Unit-first 结构。教师备课的真实路径是先定位课程、再定位 Unit、再定位 Lesson，而不是先找文件类型。

推荐结构：

```text
Course
  Course Overview
    Course Outline
    Introduction
    Course-level Downloads
    Textbook / Literature Overview

  Unit 1
    Unit Overview
    Unit Plan
    Core Texts
    Lessons
      Lesson 1
        Lesson Plan
        iSpring
        Lesson Text / Teacher Notes
        Handouts
        Homework
        Assessment / Quiz / H5P
        Other Downloads
      Lesson 2
      ...

  Unit 2
  ...
```

不推荐结构：

```text
Course
  All Outlines
  All Unit Plans
  All Lesson Plans
  All iSpring
  All Materials
```

这种文件类型优先的结构会让新教师难以判断资源之间的教学顺序和上下文。

## 3. ENG3U 样板课程现状

当前本地 ENG3U 已经具备作为样板课程的基础数据。

审计状态：

- 课程完成状态：True
- Lessons：36/36
- Lesson text exports：36 个 DOCX，71 个 TXT
- Activity pages：89
- iSpring packages：37/37
- 唯一资源覆盖：165/165
- 资源引用覆盖：240/240
- 下载文件校验：165/165 valid，0 failed
- 普通资源类型：
  - DOCX：56/56
  - PDF：37/37
  - Video：63/63
  - H5P：9/9
- iSpring 分段视频：本地约 709 个 video*.mp4，约 1.79GB
- ENG3U 总目录规模：约 7.67GB，约 6657 个文件

当前 ENG3U 的 Unit 映射建议：

| Unit | 标题 | 核心内容 |
| --- | --- | --- |
| Unit 1 | Macbeth | Shakespeare, Macbeth |
| Unit 2 | Frankenstein | Mary Shelley, Frankenstein |
| Unit 3 | Media Studies | media forms, bias, propaganda, persuasion, marketing |
| Unit 4 | Novel Study / Essay Writing | essay structure, audience, revision, editing |
| Unit 5 | Short Stories | short stories and literary lenses |

Unit 5 已发现的短篇 / 阅读材料线索包括：

- The Birthmark
- Sunday Park / 可能为 Sunday in the Park，需要核对原始材料
- Borders
- Train from Rhodesia
- Indian Education

这些短篇中可能存在版权限制，不能简单按“教材文件”上传全文。需要为每个文本标记版权状态。

## 4. 教材与文学作品处理原则

ENG3U 这类课程可能没有统一教材，而是由前任教师根据大纲组合文学作品、短篇、视频和作业材料。因此教材管理不能只做“上传一本 textbook PDF”。

建议建立 Literature / Text Registry：

```json
{
  "id": "macbeth",
  "title": "Macbeth",
  "author": "William Shakespeare",
  "type": "play",
  "units": [1],
  "lessons": ["U1L1", "U1L2", "U1L3", "U1L4", "U1L5", "U1L6", "U1L7"],
  "copyrightStatus": "public_domain",
  "sourceStatus": "downloadable",
  "localFile": "texts/macbeth.pdf",
  "notes": "Core text for Unit 1"
}
```

版权状态建议：

| 状态 | 含义 | 网站行为 |
| --- | --- | --- |
| public_domain | 公版文本 | 可下载本地文件 |
| school_licensed | 学校有授权 | 可按授权范围展示或下载 |
| link_only | 仅允许外链 | 显示来源链接，不本地提供全文 |
| needs_review | 需人工确认 | 不提供下载，只显示待核查 |
| unavailable | 暂无合法来源 | 显示缺口，不提供文件 |

对于 Macbeth、Frankenstein、The Birthmark 等公版文本，可后续下载可靠版本并归档。对于 Borders、Indian Education 等现代作品，需要先确认授权或只保留 bibliographic reference / 教师说明。

## 5. 推荐技术栈

### 5.1 前端

推荐：

- React
- TypeScript
- Vite
- 普通 CSS / CSS Modules
- Fuse.js 用于本地搜索

原因：

- 课程门户主要是结构化浏览、搜索和下载，不需要重后台。
- React + TypeScript 足够管理复杂 Unit / Lesson / Resource 数据结构。
- Vite 构建轻，适合快速迭代。
- 资源体积很大，不应打入前端 bundle。

不建议：

- WordPress：iSpring 原始目录和大量本地资源不好维护。
- 重 CMS：第一阶段不需要后台录入系统。
- Next.js 全栈化：除非后续要登录、权限、数据库和动态管理。
- 纯 HTML 手写：课程数量增加后维护成本会快速失控。

### 5.2 数据层

第一阶段使用静态 JSON manifest，不上数据库。

核心文件：

```text
courseware/
  ENG3U/
    course-manifest.json
    Unit 1/
    Unit 2/
    ...
```

网站读取 manifest 后渲染课程、Unit、Lesson 和资源下载链接。

课程 manifest 示例：

```json
{
  "courseCode": "ENG3U",
  "title": "Grade 11 English",
  "audience": "Teachers preparing OSSD lessons",
  "units": [
    {
      "unit": 1,
      "title": "Macbeth",
      "description": "Introduction to Shakespeare's Macbeth and major themes.",
      "coreTexts": ["macbeth"],
      "unitPlan": {
        "label": "Unit 1 Plan",
        "path": "files/unit-1-plan.docx"
      },
      "lessons": [
        {
          "lesson": 1,
          "id": "U1L1",
          "title": "Introduction to Macbeth",
          "lessonPlan": {
            "label": "Lesson Plan",
            "path": "files/u1-l1-lesson-plan.docx"
          },
          "ispring": {
            "mode": "page",
            "path": "Unit 1/Lesson 1 - Introduction to Macbeth/html5-package/presentation.html"
          },
          "downloads": [
            {
              "label": "Homework Handout",
              "type": "docx",
              "path": "Unit 1/Lesson 1 - Introduction to Macbeth/downloaded_resources/homework/docx/example.docx"
            }
          ]
        }
      ]
    }
  ],
  "texts": [
    {
      "id": "macbeth",
      "title": "Macbeth",
      "author": "William Shakespeare",
      "copyrightStatus": "public_domain"
    }
  ]
}
```

### 5.3 后端

第一阶段不需要应用后端。

适用条件：

- 文件由项目维护者整理后发布。
- 教师只浏览、播放、下载。
- 不需要教师上传、权限分组、在线编辑。

后续如果需要管理后台，再增加：

- SQLite / D1 / PostgreSQL 存 metadata
- R2 / S3 存课程资源
- 登录权限控制
- 管理端上传和版本管理

## 6. 前端产品设计

### 6.1 页面结构

建议页面：

1. Course Library
   - 展示所有课程，如 ENG3U、ENG4U、MHF4U 等。
   - 第一阶段可只有 ENG3U。

2. Course Overview
   - 课程介绍
   - 课程完整度
   - Unit 列表
   - 核心文本
   - Course-level downloads

3. Unit Detail
   - Unit title
   - Unit teaching purpose
   - Core texts
   - Unit plan 下载
   - Lesson sequence
   - Unit-level assessment

4. Lesson Detail
   - Lesson title
   - Teaching focus
   - iSpring 课件入口
   - Lesson plan 下载
   - Lesson text / teacher notes 下载
   - Handouts / homework / answer / quiz / H5P / video 等资源

5. Textbook / Literature Index
   - 文本标题
   - 作者
   - 所属 Unit / Lesson
   - 版权状态
   - 下载或外链

6. Search
   - 支持按 course、unit、lesson、资源名、文本名搜索。

### 6.2 Unit-first 交互

课程页第一屏应直接出现 Unit 结构，例如：

```text
ENG3U

Unit 1  Macbeth
  7 lessons
  Core text: Macbeth
  Unit plan: available
  iSpring: 7 lessons

Unit 2  Frankenstein
  8 lessons
  Core text: Frankenstein
  Unit plan: pending
  iSpring: 8 lessons
```

点击 Unit 后再进入 lesson 列表。文件类型筛选只能作为辅助能力，不能成为主导航。

### 6.3 iSpring 展示方式

iSpring 保留原始目录结构，通过以下方式之一展示：

1. 新页面打开
   - 最稳。
   - 避免 iframe 中全屏、音视频、相对路径出问题。

2. iframe 嵌入
   - 体验更统一。
   - 需要测试 iSpring 的脚本、视频、全屏、相对路径。

第一版建议默认“打开课件”按钮进入 iSpring 原页面，后续再评估 iframe 嵌入。

注意：

- iSpring 不能直接从 `file://` 打开，建议使用 HTTP 静态服务。
- `presentation.html`、`data/`、`video*.mp4`、`slide*.js` 等相对路径必须保持不变。
- 每次迁移资源后要抽测播放，不只检查文件是否存在。

### 6.4 下载资源展示

每个 Lesson 的下载资源按教学用途分组：

```text
Lesson Plan
Lesson Text / Teacher Notes
Handouts
Homework
Assessment
Answer / Quiz / H5P
Videos
Other
```

每个资源显示：

- 文件名
- 类型
- 大小
- 来源角色：lesson / homework / consolidation / assessment
- 下载按钮
- 备注：替代文件、旧域名恢复、需版权确认等

## 7. 资源目录与版本管理

建议保留当前课程包结构，同时新增 manifest 层。

推荐目录：

```text
courseware/
  ENG3U/
    course-manifest.json
    texts/
      macbeth.pdf
      frankenstein.pdf
    plans/
      unit-plans/
      lesson-plans/
    Unit 1/
      Lesson 1 - Introduction to Macbeth/
        html5-package/
        downloaded_resources/
        text_export/
    Unit 2/
```

规则：

- iSpring 原包不拆散。
- 新增的 unit plan / lesson plan 放到 `plans/` 或对应 Unit / Lesson 内。
- 现有 Moodle 抓取资源保持原路径，manifest 只引用它们。
- 不要把大文件复制多份；如有重复资源，用 manifest 多处引用同一文件。
- 每次导入新文件后重新生成 manifest 和审计报告。

## 8. 自动化工具

建议保留并扩展 Python 工具链。

已有方向：

- 课程索引生成
- 资源覆盖审计
- iSpring 包审计
- 下载资源校验
- lesson text 导出

建议新增：

1. `build_course_manifest.py`
   - 从 `ENG3U_OFFLINE_INDEX.json`、resource index、目录结构生成网站 manifest。

2. `detect_literature_texts.py`
   - 从 lesson 标题、iSpring slide JS、作业 DOCX 文件名、lesson 文本中抽取文学作品候选。

3. `validate_course_portal_assets.py`
   - 验证 manifest 中每个文件是否存在。
   - 验证 iSpring 入口是否存在。
   - 验证资源路径是否仍在课程目录内。

4. `copy_teacher_documents.py`
   - 将用户提供的 unit plan / lesson plan 按 Unit / Lesson 归档。

## 9. 本地运行方案

本地或校内使用可以用静态服务器。

推荐：

```text
frontend dev server
  serves React app

courseware static server
  serves ENG3U resources and iSpring
```

也可以先把网站和资源放在同一个静态根目录：

```text
site/
  index.html
  assets/
  courseware/
    ENG3U/
```

注意：如果课程资源很大，本地测试时可以直接指向 `D:\工作文件\SUNNYBROOK\courseware`，不复制。

## 10. 线上部署方案

### 10.1 轻量线上方案

适合第一版内部试用。

- 前端：Cloudflare Pages / Sites
- Metadata：随前端一起部署的 JSON
- 大文件资源：R2 / S3 / 对象存储 / 校内静态服务器
- iSpring：作为静态目录上传到对象存储或独立静态服务

优点：

- 便宜、简单、稳定。
- 前端构建包小。
- 大文件不影响前端部署。

风险：

- 如果资源公开，则所有拿到链接的人都可能访问。
- 需要处理跨域、缓存和大文件下载。

### 10.2 权限控制方案

适合正式教师使用。

- 前端：Cloudflare Pages / Sites
- 资源：Cloudflare R2
- 鉴权：Cloudflare Access / 学校 SSO / 简单账号系统
- Metadata API：Cloudflare Workers / D1

用途：

- 只允许教师访问。
- 不公开受版权保护的材料。
- 记录版本和资源状态。

### 10.3 不建议直接做法

不建议把整个 `courseware/ENG3U` 打包进前端部署产物。ENG3U 单门课已经约 7.67GB，直接进入前端构建会导致：

- 构建慢
- 上传慢
- 部署失败概率高
- 缓存不可控
- 后续多门课无法扩展

## 11. 安全与版权

需要特别关注：

1. Moodle 抓取资源
   - 这些资源可能只适用于学校内部教学。
   - 不能默认公开到公网。

2. 文学作品
   - 公版可下载。
   - 现代短篇多数需要授权。
   - 未确认版权的作品只显示标题和教学位置，不提供本地全文下载。

3. iSpring
   - iSpring 包中包含教师讲解视频、课程图片、字体和媒体。
   - 如上线，应确认是否允许教师范围访问。

4. 链接权限
   - 不要把带登录 token 的原始 Moodle URL 暴露到线上页面。
   - 网站应使用本地归档后的资源链接或受控资源链接。

## 12. 分阶段实施计划

### Phase 1：文档和数据规范

目标：

- 完成项目方案。
- 固定 Unit-first 信息架构。
- 定义 course manifest schema。
- 定义教材版权状态字段。

交付：

- 本文档
- manifest schema 草案
- ENG3U Unit 映射表

### Phase 2：ENG3U Manifest

目标：

- 从现有 ENG3U 离线索引生成 `course-manifest.json`。
- 把 iSpring、lesson text、downloaded resources、direct mirrors 统一挂到 Unit / Lesson。
- 将用户提供的 unit plan / lesson plan 归档并纳入 manifest。

交付：

- `courseware/ENG3U/course-manifest.json`
- manifest 校验脚本
- 教材候选清单

### Phase 3：前端 MVP

目标：

- 建立 React + TypeScript + Vite 前端。
- 实现 Course Overview、Unit Detail、Lesson Detail、Text Index。
- 支持本地搜索和下载。
- 支持打开 iSpring。

交付：

- 本地可运行网站
- ENG3U 可浏览版本

### Phase 4：播放与资源 QA

目标：

- 抽测所有 Unit 的 iSpring。
- 检查下载链接。
- 检查 manifest 缺失项。
- 标记版权风险资源。

交付：

- QA 报告
- 待补资源清单
- 版权待确认清单

### Phase 5：线上试部署

目标：

- 前端上线。
- 课程资源以受控方式托管。
- 测试教师端访问体验。

交付：

- 线上预览地址
- 部署说明
- 资源访问策略

## 13. 验收标准

第一版 ENG3U 门户应满足：

- 网站按 Unit 展示课程结构。
- 每个 Unit 能看到 Unit plan、核心文本、Lesson 列表。
- 每个 Lesson 能看到 iSpring 入口和对应下载文件。
- iSpring 不作为普通下载文件，而是作为页面展示入口。
- 普通文件可下载。
- 教材 / 文学作品有清单，并标注版权状态。
- manifest 中引用的文件全部存在。
- 至少每个 Unit 抽测一个 iSpring 可通过 HTTP 正常播放。
- 线上部署方案明确，不把 7GB 课程包直接打进前端构建。

## 14. 当前结论

这个项目适合采用“静态前端 + 结构化 manifest + 独立资源托管”的方式建设。第一版不需要数据库和重后台，重点应放在：

1. Unit-first 信息架构。
2. ENG3U 课程资源标准化。
3. iSpring 原目录稳定播放。
4. 教材和文学作品版权判断。
5. 后续多课程可扩展的数据模型。

ENG3U 已经具备足够完整的素材基础，可以作为第一门样板课程进入 manifest 生成和前端 MVP 阶段。
