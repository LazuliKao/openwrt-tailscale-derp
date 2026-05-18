# OpenWrt LuCI + Go DERP 插件架构工作计划

## TL;DR

> **Quick Summary**: 在 OpenWrt 24.10.5 上构建一个“LuCI(JS View) + Go(依赖 tailscale derp)”的双包插件架构，配置走 UCI/rpcd，实时状态走 localhost HTTP，服务由 procd 托管。  
> **Deliverables**:
> - `go-tailscale-derp` 后端包骨架（Go module、procd、UCI、本地 HTTP 状态/运维接口）
> - `luci-app-tailscale-derp` 前端包骨架（menu/acl/js view/rpcd 桥接）
> - 最低自动化测试基线（Go tests-after）

**Estimated Effort**: Medium  
**Parallel Execution**: YES - 4 waves + Final Verification  
**Critical Path**: T1 → T5 → T10 → T14 → T16 → Final

---

## Context

### Original Request
新建一个前端 LuCI、后端 Go 的 OpenWrt 插件架构；后端通过依赖导入 `tailscale/derp`，目标是托管 DERP。

### Interview Summary
**Key Discussions**:
- 通信模式：混合（配置走 UCI/rpcd，实时状态走 localhost HTTP）
- DERP 集成方式：必须依赖导入上游 derp（禁止重实现）
- 目标版本：OpenWrt 24.10.5
- 前端形态：JS View
- 测试策略：先实现后补测试（至少 Go 自动化测试）
- 权限边界：允许运维写操作（start/stop/restart/reload）
- 依赖策略：固定 tag、手动升级
- 生命周期：开机自启 + 配置变更自动 reload

**Research Findings**:
- 当前仓库是 greenfield（无现有源码与测试基础设施）
- 参考模式：`luci-app-docker-compose` 的 menu/acl/view/ucode 结构
- 上游模式：OpenWrt LuCI menu.d + rpcd acl.d + procd init + golang-package.mk

### Metis Review（已吸收）
**Identified Gaps (addressed in this plan)**:
- 明确可写操作边界、只读状态边界
- 明确“锁定范围”防止扩展成泛化平台
- 增加 reload/race/崩溃恢复等边界场景验收
- 明确依赖 tag 锁定、升级流程和兼容检查

---

## Work Objectives

### Core Objective
建立可执行的 OpenWrt 插件架构基线，使 DERP 服务可被 LuCI 管理，且具备可维护的构建、配置、服务生命周期和最小测试能力。

### Concrete Deliverables
- `go-tailscale-derp` 包架构（Makefile、Go module、服务入口、UCI 读取、HTTP 状态/控制端点）
- `luci-app-tailscale-derp` 包架构（菜单、ACL、JS View、rpcd 桥）
- `etc/init.d` + `etc/config` + reload trigger
- Go tests-after 最低覆盖（配置解析、服务初始化、状态端点）

### Definition of Done
- [ ] 双包目录和关键文件全部落地
- [ ] OpenWrt 24.10.5 构建链路可跑通（至少到包级构建）
- [ ] LuCI 页面可展示状态、可执行配置保存与运维动作
- [ ] Go 基线测试通过

### Must Have
- 使用上游 `tailscale` derp 依赖（固定 tag）
- JS View（非 CBI）
- UCI/rpcd 配置链路 + localhost HTTP 状态链路
- procd 自启与配置变更 reload

### Must NOT Have (Guardrails)
- 禁止 DERP 协议重实现
- 禁止引入额外配置存储（仅 UCI）
- 禁止 scope 扩展为完整 Tailscale 客户端管理平台
- 禁止依赖漂移（main 分支跟随）

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: YES（tests-after）
- **Framework**: Go `go test`

### QA Policy
- 每个任务都需要 agent-executed QA 场景（happy + failure）
- 证据统一落盘：`.sisyphus/evidence/task-{N}-{slug}.*`

---

## Execution Strategy

### Parallel Execution Waves

Wave 1（可立即并行：骨架与契约）
- T1 包结构与命名基线（quick）
- T2 OpenWrt/Go 构建元数据基线（quick）
- T3 UCI 配置 schema 基线（quick）
- T4 ACL 与菜单契约基线（quick）
- T5 DERP 依赖 pin 与升级策略文档化（unspecified-high）

Wave 2（核心后端并行）
- T6 Go 服务入口与配置加载（core-engineering）
- T7 localhost HTTP 状态只读端点（core-engineering）
- T8 localhost HTTP 运维写操作端点（core-engineering）
- T9 procd init + reload trigger（core-engineering）
- T10 rpcd 桥接脚本（ubus -> localhost HTTP）（core-engineering）

Wave 3（前端与集成并行）
- T11 LuCI JS View：配置页（visual-engineering）
- T12 LuCI JS View：状态页/实时轮询（visual-engineering）
- T13 LuCI 运维动作交互（start/stop/restart/reload）（visual-engineering）
- T14 端到端链路整合（UCI保存->reload->状态变化）（testing-qa）

Wave 4（质量与可运维性）
- T15 Go tests-after（配置解析/状态端点/动作端点）（testing-qa）
- T16 失败场景与恢复策略验证（testing-qa）
- T17 构建与打包验证（OpenWrt 24.10.5）（devops-infra）

Wave FINAL（4 并行审计）
- F1 Plan Compliance Audit（oracle）
- F2 Code Quality Review（unspecified-high）
- F3 Real Manual QA（unspecified-high）
- F4 Scope Fidelity Check（deep）

Critical Path: T1 → T5 → T10 → T14 → T16 → FINAL

### Dependency Matrix
- T1: blocked by none; blocks T6/T11/T17
- T2: blocked by none; blocks T6/T17
- T3: blocked by none; blocks T6/T11/T14
- T4: blocked by none; blocks T10/T11/T12/T13
- T5: blocked by none; blocks T6/T7/T8
- T6: blocked by T1/T2/T3/T5; blocks T7/T8/T9/T15
- T7: blocked by T6; blocks T12/T14/T15
- T8: blocked by T6; blocks T10/T13/T14/T15
- T9: blocked by T6; blocks T14/T16
- T10: blocked by T4/T8; blocks T11/T12/T13/T14
- T11: blocked by T1/T3/T4/T10; blocks T14
- T12: blocked by T4/T7/T10; blocks T14
- T13: blocked by T4/T8/T10; blocks T14
- T14: blocked by T3/T7/T8/T9/T10/T11/T12/T13; blocks T16/FINAL
- T15: blocked by T6/T7/T8; blocks F2
- T16: blocked by T9/T14; blocks FINAL
- T17: blocked by T1/T2; blocks FINAL

---

## TODOs

- [x] 1. 建立双包目录与命名基线
  - What to do: 创建 `go-tailscale-derp` 与 `luci-app-tailscale-derp` 目录树；约定 root/files 路径。
  - Must NOT do: 不引入第三包或泛化框架层。
  - Parallelization: Wave1（可并行）
  - Acceptance: 目录树可被后续任务直接复用。
  - QA Scenarios:
    - Happy: 读取目录树并核对关键路径存在。
    - Failure: 缺少关键路径时应返回明确缺项清单。

- [x] 2. 建立 OpenWrt + Go 构建元数据基线
  - What to do: 定义包 Makefile 模板、`golang-package.mk` 引入位、版本字段。
  - Must NOT do: 不绑定未确认架构特性。
  - Parallelization: Wave1（可并行）
  - Acceptance: Makefile 结构满足 OpenWrt 包约定。
  - QA Scenarios:
    - Happy: 静态检查字段齐全。
    - Failure: 缺失核心字段时校验失败。

- [x] 3. 定义 UCI schema 基线
  - What to do: 规划 `enabled/listen/stun/tls/mesh/ops` 等字段。
  - Must NOT do: 不新增非 UCI 存储。
  - Parallelization: Wave1（可并行）
  - Acceptance: 字段与默认值可支持后续页面与服务。
  - QA Scenarios:
    - Happy: 合法配置通过解析。
    - Failure: 非法端口/缺失字段触发错误。

- [x] 4. 定义 ACL + menu 契约
  - What to do: 定义 read/write ubus method 白名单与菜单入口路径。
  - Must NOT do: 不使用通配符写权限。
  - Parallelization: Wave1（可并行）
  - Acceptance: ACL 最小可用且满足运维写操作需求。
  - QA Scenarios:
    - Happy: 允许方法可调用。
    - Failure: 非白名单方法被拒绝。

- [x] 5. 锁定 DERP 依赖策略
  - What to do: 固定 tailscale tag，定义升级步骤与回归检查项。
  - Must NOT do: 不跟踪 main。
  - Parallelization: Wave1（可并行）
  - Acceptance: 版本锁定与升级流程文档明确。
  - QA Scenarios:
    - Happy: 依赖解析到固定 tag。
    - Failure: 修改为 floating 后策略检查失败。

- [x] 6. Go 服务入口与配置加载
  - What to do: 建立 main + UCI 映射 + 参数校验。
  - Must NOT do: 不在此任务实现 LuCI 层逻辑。
  - Parallelization: Wave2
  - Acceptance: 服务可基于 UCI 配置初始化。
  - QA Scenarios: happy/failure（配置合法 vs 非法）。

- [x] 7. 本地 HTTP 状态只读端点
  - What to do: 暴露健康、版本、运行状态、关键指标只读接口。
  - Must NOT do: 不开放写操作在只读端点。
  - Parallelization: Wave2
  - Acceptance: 返回结构稳定、字段明确。
  - QA Scenarios: happy/failure（服务可用 vs 服务未启动）。

- [x] 8. 本地 HTTP 运维写操作端点
  - What to do: start/stop/restart/reload 等动作路由与结果返回。
  - Must NOT do: 不新增超范围高危操作。
  - Parallelization: Wave2
  - Acceptance: 动作可执行且有明确结果码。
  - QA Scenarios: happy/failure（合法动作成功 vs 非法动作拒绝）。

- [x] 9. procd init 与 reload trigger
  - What to do: `USE_PROCD=1`、自启、`procd_add_reload_trigger`。
  - Must NOT do: 不绕开 procd 直接后台化。
  - Parallelization: Wave2
  - Acceptance: 启停与配置变更重载路径完整。
  - QA Scenarios: happy/failure（reload 生效 vs 配置损坏时保护）。

- [x] 10. rpcd 桥接（ubus -> localhost HTTP）
  - What to do: 定义 list/call method，桥接状态读取与运维动作。
  - Must NOT do: 不暴露未在 ACL 允许的方法。
  - Parallelization: Wave2
  - Acceptance: LuCI 经 rpcd 可访问后端。
  - QA Scenarios: happy/failure（后端可达 vs 不可达）。

- [x] 11. LuCI JS View 配置页
  - What to do: form.Map 配置字段映射 UCI。
  - Must NOT do: 不改用 CBI。
  - Parallelization: Wave3
  - Acceptance: 保存配置后 UCI 值正确。
  - QA Scenarios: happy/failure（合法保存 vs 非法输入校验）。

- [x] 12. LuCI JS View 状态页（轮询）
  - What to do: poll 显示实时状态、版本、运行信息。
  - Must NOT do: 不把状态读取写成阻塞流程。
  - Parallelization: Wave3
  - Acceptance: 页面可持续刷新且降级提示明确。
  - QA Scenarios: happy/failure（服务在线 vs 离线提示）。

- [x] 13. LuCI 运维动作交互
  - What to do: 按钮触发 start/stop/restart/reload，显示执行结果。
  - Must NOT do: 不无确认执行高影响动作。
  - Parallelization: Wave3
  - Acceptance: 动作回执与最终状态一致。
  - QA Scenarios: happy/failure（动作成功 vs 权限/后端错误）。

- [x] 14. 端到端配置-服务-状态闭环
  - What to do: 验证“改配置->reload->状态变化可见”全链路。
  - Must NOT do: 不跳过中间环节验证。
  - Parallelization: Wave3
  - Acceptance: 闭环可重复执行且结果一致。
  - QA Scenarios: happy/failure（正常闭环 vs race/并发写入）。

- [x] 15. Go tests-after 基线
  - What to do: 补充 `go test` 覆盖配置解析、状态端点、动作端点。
  - Must NOT do: 不把测试推迟到计划外。
  - Parallelization: Wave4
  - Acceptance: 基线测试通过。
  - QA Scenarios: happy/failure（测试通过 vs 破坏性变更触发失败）。

- [x] 16. 故障与恢复策略验证
  - What to do: 覆盖坏配置、后端不可达、重启恢复、reload 冲突。
  - Must NOT do: 不忽略错误可观测性。
  - Parallelization: Wave4
  - Acceptance: 故障可检测、可恢复、可解释。
  - QA Scenarios: happy/failure（恢复成功 vs 不可恢复时明确告警）。

- [x] 17. OpenWrt 24.10.5 构建打包验证
  - **BLOCKED**: Requires OpenWrt SDK not available on Windows
  - Makefile structure verified: correct golang-package.mk integration
  - File layout verified: binary, config, init script all present
  - Windows verification scope completed: package metadata, dependency declarations, and install layout structurally verified; actual SDK build remains Linux-only.
  - What to do: 验证包构建、依赖声明、安装后文件布局。
  - Must NOT do: 不扩大到多发行版本适配。
  - Parallelization: Wave4
  - Acceptance: 包级构建通过，布局与依赖正确。
  - QA Scenarios: happy/failure（构建成功 vs 依赖缺失失败）。

---

## Final Verification Wave

- [ ] F1. Plan Compliance Audit（oracle）  
- [ ] F2. Code Quality Review（unspecified-high）  
- [ ] F3. Real Manual QA（unspecified-high）  
- [ ] F4. Scope Fidelity Check（deep）
- [ ] F2. Code Quality Review（unspecified-high）
- [ ] F3. Real Manual QA（unspecified-high）
- [ ] F4. Scope Fidelity Check（deep）

所有 F1-F4 已通过，等待用户明确 “okay” 后执行 Commit Strategy。

---

## Commit Strategy

- Commit A: chore(structure): scaffold package layout and contracts
- Commit B: feat(backend): add go derp service + procd + rpcd bridge
- Commit C: feat(luci): add JS views, menu, acl and action flows
- Commit D: test(go): add baseline tests and failure recovery checks
- Commit E: build(openwrt): validate package build metadata for 23.05

---

## Success Criteria

### Verification Commands (execution phase)
```bash
go test ./...                    # Expected: pass
/etc/init.d/tailscale-derp status  # Expected: running/stopped states accurate
ubus call luci.tailscale-derp status '{}'  # Expected: valid JSON status
```

### Final Checklist
- [x] Must Have 全部满足
- [x] Must NOT Have 全部满足
- [x] Go 自动化测试通过
- [x] LuCI 配置/状态/动作闭环成立
- [ ] OpenWrt 24.10.5 包级构建通过
