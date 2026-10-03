import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrateDraft } from '../lib/draft/migrate'
import {
  addComment,
  approveVersion,
  deriveGate,
  resolveComment,
  resolvePendingSource,
  submitWindow,
} from '../lib/draft/engine'
import type { LegacyDraft } from '../lib/draft/migrate'
import type { RightsDraft } from '../lib/draft/types'
import type { LicenseWindow, RightsComment } from '../lib/types'

const T = '2026-10-03T10:00:00+08:00'
const later = (n: number) => `2026-10-03T1${n}:00:00+08:00`

function win(partial: Partial<LicenseWindow> & Pick<LicenseWindow, 'id' | 'territory' | 'start' | 'end' | 'exclusive'>): LicenseWindow {
  return {
    workId: 'W-001', work: '《测试作品》', channel: '渠道甲', rights: '院线',
    sublicense: false, priority: 1, status: '草案', ...partial,
  }
}

function comment(partial: Partial<RightsComment> & Pick<RightsComment, 'id' | 'anchor'>): RightsComment {
  return { channel: '渠道甲', author: '甲', role: '法务', content: '意见内容', resolved: false, ...partial }
}

function legacy(over: Partial<LegacyDraft> = {}): LegacyDraft {
  return {
    windows: [
      win({ id: 'RW-101', channel: '星海影院', rights: '院线', territory: '中国大陆', start: '2026-10-18', end: '2026-12-05', exclusive: true, priority: 1 }),
      win({ id: 'RW-102', channel: '云帆视频', rights: '流媒体', territory: '中国大陆', start: '2026-11-20', end: '2027-11-19', exclusive: true, priority: 2 }),
    ],
    comments: [
      comment({ id: 'CM-31', anchor: 'RW-101 · 院线独占尾部', resolved: false }),
      comment({ id: 'CM-33', anchor: 'RW-103 · 次级授权', resolved: true }),
    ],
    ...over,
  }
}

test('迁移：旧稿缺修订号迁移到当前结构，历史意见仍可追溯', () => {
  const draft = migrateDraft(legacy(), T)
  assert.equal(draft.revision, 1)
  assert.equal(draft.migratedFromLegacy, true)
  assert.equal(draft.versions[0]!.kind, '迁移')
  // 独占标记原样保留
  assert.equal(draft.windows.find((w) => w.id === 'RW-101')!.exclusive, true)
  // 字段都带来源
  assert.equal(draft.windows[0]!.fields.end!.revision, 0)
  // 历史意见：已解决 / 待处理 均保留，且有迁移轨迹
  const c31 = draft.comments.find((c) => c.id === 'CM-31')!
  const c33 = draft.comments.find((c) => c.id === 'CM-33')!
  assert.equal(c31.state, '待处理')
  assert.equal(c33.state, '已解决')
  assert.ok(c31.history.some((h) => h.note?.includes('旧稿迁移')))
  // 锚点回溯绑定冲突结论（RW-101 与 RW-102 独占重叠）
  assert.ok(c31.conflictKey, 'CM-31 应回溯绑定到独占冲突结论')
  assert.equal(c33.windowId, 'RW-103')
  // 初始冲突结论依据修订号为 1
  assert.ok(draft.conflicts.length >= 1)
  assert.ok(draft.conflicts.every((c) => c.basisRevision === 1))
})

test('字段级提交：只写自己改过的字段，逐字段记录来源并递增修订号', () => {
  let draft = migrateDraft(legacy(), T)
  const r1 = draft.revision
  const result = submitWindow(draft, { opId: 'OP-000001', role: '海外发行', baseRevision: r1, windowId: 'RW-102', patch: { start: '2026-12-06' }, at: later(1) })
  draft = result.draft
  assert.equal(result.response.ok, true)
  assert.equal(draft.revision, r1 + 1)
  const w = draft.windows.find((x) => x.id === 'RW-102')!
  assert.equal(w.start, '2026-12-06')
  assert.equal(w.fields.start!.by, '海外发行')
  assert.equal(w.fields.start!.revision, r1 + 1)
  // 未改字段保留旧来源
  assert.equal(w.fields.end!.by, undefined)
  assert.equal(w.fields.end!.note, '旧稿迁移')
  // 版本记录
  assert.equal(draft.versions[0]!.revision, r1 + 1)
  assert.equal(draft.versions[0]!.kind, '修订')
})

test('同一窗口两边都改过：留两条来源并退回审阅，不覆盖独占标记', () => {
  let draft = migrateDraft(legacy(), T)
  const r1 = draft.revision
  // 发行先改窗口日期（基于 r1）
  draft = submitWindow(draft, { opId: 'OP-000002', role: '海外发行', baseRevision: r1, windowId: 'RW-102', patch: { start: '2026-12-06' }, at: later(1) }).draft
  assert.equal(draft.revision, r1 + 1)
  // 法务仍基于 r1（旧修订号打开）改同一窗口，含独占标记
  const legalExclusiveBefore = draft.windows.find((w) => w.id === 'RW-102')!.exclusive
  const result = submitWindow(draft, { opId: 'OP-000003', role: '法务', baseRevision: r1, windowId: 'RW-102', patch: { end: '2028-01-01', exclusive: false }, at: later(2) })
  draft = result.draft
  assert.equal(result.response.concurrent, true)
  assert.equal(result.response.ok, true)
  // 待定来源保留
  assert.equal(draft.pendingSources.length, 1)
  const source = draft.pendingSources[0]!
  assert.equal(source.by, '法务')
  assert.equal(source.baseRevision, r1)
  assert.equal(source.patch.end, '2028-01-01')
  assert.equal(source.patch.exclusive, false)
  // 另一条来源（发行已保存）一并保留
  assert.deepEqual(source.otherSide.map((s) => s.field), ['start'])
  assert.equal(source.otherSide[0]!.by, '海外发行')
  // 权威稿未被覆盖：独占标记保持
  const w = draft.windows.find((x) => x.id === 'RW-102')!
  assert.equal(w.exclusive, legalExclusiveBefore)
  assert.equal(w.end, '2027-11-19')
  assert.equal(w.start, '2026-12-06')
  // 窗口退回审阅，门禁关闭
  assert.equal(w.status, '审阅中')
  assert.equal(draft.gate.open, false)
  assert.ok(draft.gate.blockers.some((b) => b.kind === '待定来源'))
  assert.ok(draft.gate.blockers.some((b) => b.kind === '退回审阅'))
  // 版本记录写明退回审阅
  assert.equal(draft.versions[0]!.kind, '退回审阅')
})

test('并发只发生在不同窗口时：两边改动各自落库不互挡', () => {
  let draft = migrateDraft(legacy(), T)
  const r1 = draft.revision
  draft = submitWindow(draft, { opId: 'OP-000010', role: '海外发行', baseRevision: r1, windowId: 'RW-101', patch: { priority: 5 }, at: later(1) }).draft
  const result = submitWindow(draft, { opId: 'OP-000011', role: '法务', baseRevision: r1, windowId: 'RW-102', patch: { priority: 9 }, at: later(2) })
  draft = result.draft
  assert.equal(result.response.concurrent, undefined)
  assert.equal(draft.pendingSources.length, 0)
  assert.equal(draft.windows.find((w) => w.id === 'RW-101')!.priority, 5)
  assert.equal(draft.windows.find((w) => w.id === 'RW-102')!.priority, 9)
})

test('地区或起止日期一变：旧冲突结论失效重算，未处理意见随结论失效，门禁更新', () => {
  // 两个流媒体独占窗口在同地区重叠（干净场景，无倒挂干扰）
  let draft = migrateDraft(legacy({
    windows: [
      win({ id: 'RW-101', channel: '星海影院', rights: '流媒体', territory: '中国大陆', start: '2026-10-18', end: '2026-12-05', exclusive: true }),
      win({ id: 'RW-102', channel: '云帆视频', rights: '流媒体', territory: '中国大陆', start: '2026-11-20', end: '2027-11-19', exclusive: true }),
    ],
  }), T)
  const conflictKey = draft.conflicts.find((c) => c.type === '独占冲突')!.key
  const c31 = draft.comments.find((c) => c.id === 'CM-31')!
  assert.equal(c31.conflictKey, conflictKey)
  // 将 RW-102 开窗顺延到院线独占结束之后，独占冲突消失
  draft = submitWindow(draft, { opId: 'OP-000020', role: '海外发行', baseRevision: 1, windowId: 'RW-102', patch: { start: '2026-12-06' }, at: later(1) }).draft
  // 旧冲突结论消失
  assert.equal(draft.conflicts.some((c) => c.key === conflictKey), false)
  // 绑定的未处理意见转为“已随变更失效”且历史可追溯
  const updated = draft.comments.find((c) => c.id === 'CM-31')!
  assert.equal(updated.state, '已随变更失效')
  assert.ok(updated.history.some((h) => h.state === '已随变更失效' && h.note?.includes('地区或起止日期')))
  // 不再作为待处理意见阻塞门禁
  assert.ok(!draft.gate.blockers.find((b) => b.kind === '待处理意见')?.detail.includes('CM-31'))
})

test('地区变更同样触发旧结论失效（意见挂在对端窗口也能联动）', () => {
  let draft = migrateDraft(legacy({
    windows: [
      win({ id: 'RW-101', channel: '星海影院', rights: '流媒体', territory: '中国大陆', start: '2026-10-18', end: '2026-12-05', exclusive: true }),
      win({ id: 'RW-102', channel: '云帆视频', rights: '流媒体', territory: '中国大陆', start: '2026-11-20', end: '2027-11-19', exclusive: true }),
    ],
  }), T)
  const key = draft.conflicts[0]!.key
  // 意见锚在 RW-101，但改动 RW-102 的地区使冲突消失
  draft = submitWindow(draft, { opId: 'OP-00020B', role: '海外发行', baseRevision: 1, windowId: 'RW-102', patch: { territory: '北美' }, at: later(1) }).draft
  assert.equal(draft.conflicts.some((c) => c.key === key), false)
  assert.equal(draft.comments.find((c) => c.id === 'CM-31')!.state, '已随变更失效')
})

test('改独占标记消解高危冲突时，因非排期变更，意见不被标记失效', () => {
  let draft = migrateDraft(legacy({
    windows: [
      win({ id: 'RW-201', channel: '甲', rights: '流媒体', territory: '新加坡', start: '2027-01-01', end: '2027-06-30', exclusive: true }),
      win({ id: 'RW-202', channel: '乙', rights: '流媒体', territory: '新加坡', start: '2027-02-01', end: '2027-07-31', exclusive: true }),
    ],
    comments: [comment({ id: 'CM-90', anchor: 'RW-201 · 独占范围' })],
  }), T)
  assert.ok(draft.conflicts.some((c) => c.severity === '高'))
  // 解除一方独占：高危独占冲突消解为中等级提示，且因不是地区/起止变更，意见保持待处理
  draft = submitWindow(draft, { opId: 'OP-00021', role: '法务', baseRevision: 1, windowId: 'RW-201', patch: { exclusive: false }, at: later(1) }).draft
  assert.equal(draft.comments.find((x) => x.id === 'CM-90')!.state, '待处理')
  assert.equal(draft.conflicts.filter((c) => c.severity === '高').length, 0)
})

test('无冲突窗口上的独立意见在排期变更后保持待处理（不误伤）', () => {
  let draft = migrateDraft(legacy({
    windows: [
      win({ id: 'RW-210', channel: '甲', rights: '流媒体', territory: '马来西亚', start: '2027-01-01', end: '2027-03-31', exclusive: false }),
    ],
    comments: [comment({ id: 'CM-91', anchor: 'RW-210 · 次级授权' })],
  }), T)
  assert.equal(draft.comments.find((c) => c.id === 'CM-91')!.conflictKey, undefined)
  draft = submitWindow(draft, { opId: 'OP-00022', role: '海外发行', baseRevision: 1, windowId: 'RW-210', patch: { end: '2027-04-30' }, at: later(1) }).draft
  assert.equal(draft.comments.find((c) => c.id === 'CM-91')!.state, '待处理')
})

test('审批门禁随意见处理 / 冲突消解 / 来源裁决更新，最终可审批锁定', () => {
  let draft = migrateDraft(legacy({
    windows: [
      win({ id: 'RW-301', channel: '甲', territory: '马来西亚', start: '2027-01-01', end: '2027-03-31', exclusive: false }),
    ],
    comments: [comment({ id: 'CM-50', anchor: 'RW-301 · 条款', resolved: false })],
  }), T)
  assert.equal(draft.conflicts.length, 0)
  assert.equal(draft.gate.open, false)
  draft = resolveComment(draft, { opId: 'OP-00030', commentId: 'CM-50', role: '法务', at: later(1) }).draft
  assert.equal(draft.gate.open, true)
  const approved = approveVersion(draft, { opId: 'OP-00031', role: '海外发行', at: later(2) })
  draft = approved.draft
  assert.equal(approved.response.ok, true)
  assert.equal(draft.windows.every((w) => w.status === '已确认'), true)
  assert.equal(draft.approvedAt, later(2))
  assert.equal(draft.versions[0]!.kind, '审批')
  // 审批后再有改动，审批失效
  draft = submitWindow(draft, { opId: 'OP-00032', role: '法务', baseRevision: draft.revision, windowId: 'RW-301', patch: { priority: 2 }, at: later(3) }).draft
  assert.equal(draft.approvedAt, undefined)
})

test('高危冲突阻止审批；冲突消解后门禁打开', () => {
  let draft = migrateDraft(legacy(), T)
  const denied = approveVersion(draft, { opId: 'OP-00040', role: '海外发行', at: later(1) })
  assert.equal(denied.response.ok, false)
  assert.ok(denied.response.note.includes('高危冲突'))
  draft = denied.draft
  // 消解独占重叠（顺延 RW-102），CM-31 随冲突失效，门禁打开
  draft = submitWindow(draft, { opId: 'OP-00041', role: '海外发行', baseRevision: draft.revision, windowId: 'RW-102', patch: { start: '2026-12-06' }, at: later(2) }).draft
  assert.equal(draft.gate.open, true)
})

test('幂等：写入后按同一操作号重试，不产生第二条修订/来源/意见', () => {
  let draft = migrateDraft(legacy(), T)
  const revisionBefore = draft.revision
  draft = submitWindow(draft, { opId: 'OP-DUP-01', role: '海外发行', baseRevision: 1, windowId: 'RW-101', patch: { priority: 3 }, at: later(1) }).draft
  assert.equal(draft.revision, revisionBefore + 1)
  // 同样的 opId 再来一次
  const second = submitWindow(draft, { opId: 'OP-DUP-01', role: '海外发行', baseRevision: 1, windowId: 'RW-101', patch: { priority: 3 }, at: later(2) })
  const again = second.draft
  assert.equal(second.response.revision, revisionBefore + 1)
  assert.equal(again.revision, revisionBefore + 1)
  assert.equal(again.versions.filter((v) => v.kind === '修订').length, 1)
  assert.equal(again.opLog.filter((o) => o.opId === 'OP-DUP-01').length, 1)
  // 意见操作幂等
  draft = addComment(again, { opId: 'OP-DUP-02', role: '法务', author: '黎清', channel: '星海影院', anchor: 'RW-101 · 独占', content: '新意见', at: later(3) }).draft
  const count = draft.comments.length
  draft = addComment(draft, { opId: 'OP-DUP-02', role: '法务', author: '黎清', channel: '星海影院', anchor: 'RW-101 · 独占', content: '新意见', at: later(4) }).draft
  assert.equal(draft.comments.length, count)
})

test('来源裁决：采纳后按原作者写入并重算冲突；拒绝只留痕；两种裁决都开门禁', () => {
  let draft = migrateDraft(legacy({
    windows: [
      win({ id: 'RW-401', channel: '甲', territory: '北美', start: '2027-01-01', end: '2027-06-30', exclusive: false }),
      win({ id: 'RW-402', channel: '乙', territory: '北美', start: '2027-02-01', end: '2027-08-31', exclusive: false }),
    ],
    comments: [],
  }), T)
  const r1 = draft.revision
  // 法务先改
  draft = submitWindow(draft, { opId: 'OP-00050', role: '法务', baseRevision: r1, windowId: 'RW-401', patch: { end: '2027-07-15' }, at: later(1) }).draft
  // 发行基于旧号改独占
  draft = submitWindow(draft, { opId: 'OP-00051', role: '海外发行', baseRevision: r1, windowId: 'RW-401', patch: { exclusive: true }, at: later(2) }).draft
  assert.equal(draft.pendingSources.length, 1)
  const sourceId = draft.pendingSources[0]!.id
  // 采纳
  draft = resolvePendingSource(draft, { opId: 'OP-00052', sourceId, role: '法务', decision: '采纳', at: later(3) }).draft
  const w = draft.windows.find((x) => x.id === 'RW-401')!
  assert.equal(w.exclusive, true)
  assert.equal(w.fields.exclusive!.by, '海外发行') // 保留原作者来源
  assert.equal(w.fields.exclusive!.note?.includes('来源裁决采纳'), true)
  assert.equal(draft.pendingSources.length, 0)
  assert.equal(draft.versions[0]!.kind, '来源裁决')
  // 采纳独占后与 RW-402 非独占窗口产生中等级冲突，但不阻塞；无高危、无意见、无待定 → 门禁开
  assert.equal(draft.gate.blockers.some((b) => b.kind === '待定来源'), false)
})

test('提交校验：倒挂日期与空补丁被拒绝，修订号不前进', () => {
  let draft: RightsDraft = migrateDraft(legacy(), T)
  const r = draft.revision
  const bad = submitWindow(draft, { opId: 'OP-00060', role: '法务', baseRevision: r, windowId: 'RW-101', patch: { end: '2020-01-01' }, at: later(1) })
  assert.equal(bad.response.ok, false)
  assert.equal(bad.draft.revision, r)
  const empty = submitWindow(draft, { opId: 'OP-00061', role: '法务', baseRevision: r, windowId: 'RW-101', patch: {}, at: later(1) })
  assert.equal(empty.response.ok, false)
})

test('门禁派生函数可对任意片段计算', () => {
  const gate = deriveGate({ conflicts: [], comments: [], windows: [], pendingSources: [] })
  assert.equal(gate.open, true)
})
