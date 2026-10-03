import type { RightsType, Territory } from '../types'
import type {
  ApprovalGate,
  DraftWindow,
  GateBlocker,
  OperationResponse,
  PendingSource,
  RightsDraft,
  Role,
  VersionRecord,
  WindowField,
} from './types'
import { recomputeConflicts } from './conflicts'

const RIGHTS: RightsType[] = ['院线', '电视', '流媒体', '航空', '非院线']
const TERRITORIES: Territory[] = ['中国大陆', '中国香港', '中国台湾', '新加坡', '马来西亚', '东南亚区域', '北美']
const SCHEDULE_FIELDS: WindowField[] = ['territory', 'start', 'end']
const FIELD_LABEL: Record<WindowField, string> = {
  channel: '渠道',
  rights: '权利类型',
  territory: '地区',
  start: '开始日期',
  end: '结束日期',
  exclusive: '独占标记',
  sublicense: '次级授权',
  priority: '优先顺序',
}
const WINDOW_ID_RE = /RW-\d+/

export type Patch = Partial<Record<WindowField, string | number | boolean>>

function clone<T>(value: T): T {
  return structuredClone(value)
}

function findOp(draft: RightsDraft, opId: string) {
  return draft.opLog.find((entry) => entry.opId === opId)
}

function cached(draft: RightsDraft, opId: string): OperationResponse {
  return { ...findOp(draft, opId)!.response }
}

/** 审批门禁：高危冲突 / 未处理意见 / 退回审阅窗口 / 待定来源任一存在即关闭 */
export function deriveGate(draft: Pick<RightsDraft, 'conflicts' | 'comments' | 'windows' | 'pendingSources'>): ApprovalGate {
  const blockers: GateBlocker[] = []
  const high = draft.conflicts.filter((c) => c.severity === '高')
  if (high.length) blockers.push({ kind: '高危冲突', count: high.length, detail: high.map((c) => c.title).join('；') })
  const openComments = draft.comments.filter((c) => c.state === '待处理')
  if (openComments.length) blockers.push({ kind: '待处理意见', count: openComments.length, detail: openComments.map((c) => `${c.id} ${c.anchor}`).join('；') })
  const reviewWindows = draft.windows.filter((w) => w.status === '审阅中')
  if (reviewWindows.length) blockers.push({ kind: '退回审阅', count: reviewWindows.length, detail: reviewWindows.map((w) => `${w.id} ${w.channel}`).join('；') })
  if (draft.pendingSources.length) blockers.push({ kind: '待定来源', count: draft.pendingSources.length, detail: draft.pendingSources.map((s) => `${s.windowId} 来自${s.by}`).join('；') })
  return { open: blockers.length === 0, blockers }
}

function refreshStatus(draft: RightsDraft) {
  for (const w of draft.windows) {
    const hasHigh = draft.conflicts.some((c) => c.severity === '高' && c.windowIds.includes(w.id))
    const hasPending = draft.pendingSources.some((s) => s.windowId === w.id)
    if (hasHigh) w.status = '冲突'
    else if (hasPending) w.status = '审阅中'
    else if (w.status === '冲突' || w.status === '审阅中') w.status = '草稿'
  }
}

function validatePatch(window: { start: string; end: string }, patch: Patch): string | null {
  for (const key of Object.keys(patch) as WindowField[]) {
    const value = patch[key]
    if (key === 'rights' && !RIGHTS.includes(value as RightsType)) return `权利类型不合法：${String(value)}`
    if (key === 'territory' && !TERRITORIES.includes(value as Territory)) return `地区不合法：${String(value)}`
    if ((key === 'start' || key === 'end') && Number.isNaN(new Date(String(value)).getTime())) return `${FIELD_LABEL[key]}不是有效日期`
    if (key === 'priority' && (typeof value !== 'number' || value < 1)) return '优先顺序必须为不小于 1 的数字'
    if ((key === 'exclusive' || key === 'sublicense') && typeof value !== 'boolean') return `${FIELD_LABEL[key]}必须是布尔值`
    if (key === 'channel' && typeof value === 'string' && value.trim().length < 2) return '渠道名称至少 2 个字符'
  }
  const start = patch.start !== undefined ? String(patch.start) : window.start
  const end = patch.end !== undefined ? String(patch.end) : window.end
  if (new Date(end) < new Date(start)) return '窗口结束日期不能早于开始日期'
  return null
}

function pushVersion(draft: RightsDraft, record: Omit<VersionRecord, 'revision'>) {
  draft.versions.unshift({ ...record, revision: draft.revision })
}

/**
 * 统一提交：重算冲突、让失效结论关联的未处理意见随地区/起止变更失效、刷新门禁。
 * scheduleChanged 严格对应需求中“地区或起止日期一变”的口径。
 */
function commitChanges(
  draft: RightsDraft,
  changed: { id: string; revision: number; scheduleChanged: boolean }[],
  record: Omit<VersionRecord, 'revision'>,
  at: string,
) {
  const { conflicts, invalidatedKeys } = recomputeConflicts(
    draft.windows,
    draft.conflicts,
    changed.map(({ id, revision }) => ({ id, revision })),
  )
  draft.conflicts = conflicts
  // 冲突是窗口对级别的结论：只要其任一关联窗口发生地区/起止变更导致 key 失效，
  // 绑定该结论的未处理意见即随之失效（意见可能锚定在对端窗口上）。
  if (changed.some((c) => c.scheduleChanged)) {
    for (const comment of draft.comments) {
      if (comment.state !== '待处理' || !comment.conflictKey || !invalidatedKeys.has(comment.conflictKey)) continue
      comment.state = '已随变更失效'
      comment.history.push({ state: '已随变更失效', at, by: '系统', note: '地区或起止日期变更，旧冲突结论失效，意见退回历史追溯' })
    }
  }
  refreshStatus(draft)
  draft.gate = deriveGate(draft)
  draft.approvedAt = undefined
  pushVersion(draft, record)
}

function logResponse(draft: RightsDraft, entry: { opId: string; kind: 'submit' | 'resolveComment' | 'addComment' | 'resolveSource' | 'approve'; at: string; response: OperationResponse }) {
  draft.opLog.unshift({ ...entry })
}

export interface SubmitInput {
  opId: string
  role: Role
  /** 打开草稿时携带的修订号；落后即可能触发并发保留 */
  baseRevision: number
  windowId: string
  /** 只写自己改过的字段；空补丁拒绝 */
  patch: Patch
  at: string
}

/**
 * 字段级提交：
 * 1. 同一 opId 重试直接返回首次结果（幂等）；
 * 2. 同一窗口对端在本修订号之后改过 → 不覆盖，补丁作为第二条来源保留，窗口退回审阅，独占标记不覆盖；
 * 3. 否则只把补丁字段写进权威稿，逐字段记录来源；
 * 4. 地区/起止一变，旧冲突结论失效重算，未处理意见与门禁联动更新。
 */
export function submitWindow(draft: RightsDraft, input: SubmitInput): { draft: RightsDraft; response: OperationResponse } {
  draft = clone(draft)
  const logged = findOp(draft, input.opId)
  if (logged) return { draft, response: cached(draft, input.opId) }

  const window = draft.windows.find((w) => w.id === input.windowId)
  if (!window) return { draft, response: { ok: false, revision: draft.revision, note: `窗口 ${input.windowId} 不存在` } }
  const keys = Object.keys(input.patch) as WindowField[]
  if (!keys.length) return { draft, response: { ok: false, revision: draft.revision, note: '没有需要写入的字段' } }
  const invalid = validatePatch(window, input.patch)
  if (invalid) return { draft, response: { ok: false, revision: draft.revision, note: invalid } }

  const otherSideFields = (Object.keys(window.fields) as WindowField[])
    .filter((f) => {
      const p = window.fields[f]!
      return p.by && p.by !== input.role && p.revision > input.baseRevision
    })
    .map((f) => ({ field: f, by: window.fields[f]!.by!, revision: window.fields[f]!.revision, value: window[f] as string | number | boolean }))

  let response: OperationResponse
  if (input.baseRevision < draft.revision && otherSideFields.length) {
    // 同一窗口两边都改过：保留两条来源，退回审阅；权威稿（含独占标记）一律不覆盖
    const source: PendingSource = {
      id: `PS-${input.opId}`,
      windowId: window.id,
      opId: input.opId,
      by: input.role,
      at: input.at,
      baseRevision: input.baseRevision,
      patch: { ...input.patch },
      reason: `该窗口已被${otherSideFields[0]!.by}在修订 r${otherSideFields[0]!.revision} 保存，双方来源并列保留，退回审阅裁决`,
      otherSide: otherSideFields,
    }
    draft.pendingSources.unshift(source)
    refreshStatus(draft)
    draft.gate = deriveGate(draft)
    draft.approvedAt = undefined
    draft.revision += 1
    pushVersion(draft, {
      author: input.role,
      at: input.at,
      kind: '退回审阅',
      summary: `${window.id} ${window.channel}：${input.role}基于 r${input.baseRevision} 的提交与${otherSideFields[0]!.by}已保存改动并存，退回审阅`,
      changes: keys.map((f) => ({ op: '并发保留', detail: `${FIELD_LABEL[f]} 保留${input.role}来源，未覆盖既有值（独占标记不覆盖）`, windowId: window.id, field: f })),
    })
    response = { ok: true, revision: draft.revision, note: source.reason, concurrent: true, pendingSourceId: source.id }
  } else {
    const scheduleChanged = keys.some((f) => SCHEDULE_FIELDS.includes(f) && window[f] !== input.patch[f])
    draft.revision += 1
    for (const f of keys) {
      ;(window as unknown as Record<string, unknown>)[f] = input.patch[f]
      window.fields[f] = { field: f, by: input.role, revision: draft.revision }
    }
    commitChanges(
      draft,
      [{ id: window.id, revision: draft.revision, scheduleChanged }],
      {
        author: input.role,
        at: input.at,
        kind: '修订',
        summary: `${input.role}修订 ${window.id} ${window.channel}（基于 r${input.baseRevision}）`,
        changes: keys.map((f) => ({ op: '写入', detail: `${FIELD_LABEL[f]}由${input.role}更新`, windowId: window.id, field: f })),
      },
      input.at,
    )
    response = { ok: true, revision: draft.revision, note: `已写入 ${keys.length} 个字段，修订号 r${draft.revision}` }
  }

  logResponse(draft, { opId: input.opId, kind: 'submit', at: input.at, response })
  return { draft, response }
}

export interface ResolveSourceInput {
  opId: string
  sourceId: string
  role: Role
  decision: '采纳' | '拒绝'
  at: string
}

/** 审阅人对并列来源逐条裁决：采纳则把来源补丁按原作者写入，拒绝则仅留痕 */
export function resolvePendingSource(draft: RightsDraft, input: ResolveSourceInput): { draft: RightsDraft; response: OperationResponse } {
  draft = clone(draft)
  const logged = findOp(draft, input.opId)
  if (logged) return { draft, response: cached(draft, input.opId) }
  const index = draft.pendingSources.findIndex((s) => s.id === input.sourceId)
  if (index < 0) return { draft, response: { ok: false, revision: draft.revision, note: `待定来源 ${input.sourceId} 不存在或已裁决` } }
  const source = draft.pendingSources[index]!
  const window = draft.windows.find((w) => w.id === source.windowId)
  if (!window) return { draft, response: { ok: false, revision: draft.revision, note: `窗口 ${source.windowId} 不存在` } }

  const keys = Object.keys(source.patch) as WindowField[]
  let scheduleChanged = false
  draft.revision += 1
  if (input.decision === '采纳') {
    const invalid = validatePatch(window, source.patch)
    if (invalid) return { draft: clone(draft), response: { ok: false, revision: draft.revision - 1, note: invalid } }
    scheduleChanged = keys.some((f) => SCHEDULE_FIELDS.includes(f) && window[f] !== source.patch[f])
    for (const f of keys) {
      ;(window as unknown as Record<string, unknown>)[f] = source.patch[f]
      window.fields[f] = { field: f, by: source.by, revision: draft.revision, note: `来源裁决采纳（${input.role}）` }
    }
  }
  draft.pendingSources.splice(index, 1)
  commitChanges(
    draft,
    [{ id: window.id, revision: draft.revision, scheduleChanged: input.decision === '采纳' && scheduleChanged }],
    {
      author: input.role,
      at: input.at,
      kind: '来源裁决',
      summary: `${input.role}${input.decision} ${window.id} 来自${source.by}的并列来源`,
      changes: keys.map((f) => ({ op: input.decision, detail: `${FIELD_LABEL[f]}来源裁决：${input.decision}`, windowId: window.id, field: f })),
    },
    input.at,
  )
  const response: OperationResponse = { ok: true, revision: draft.revision, note: `已${input.decision}来源，修订号 r${draft.revision}` }
  logResponse(draft, { opId: input.opId, kind: 'resolveSource', at: input.at, response })
  return { draft, response }
}

export interface CommentInput {
  opId: string
  role: Role
  author: string
  channel: string
  anchor: string
  content: string
  at: string
}

let commentSeq = 0
export function addComment(draft: RightsDraft, input: CommentInput): { draft: RightsDraft; response: OperationResponse } {
  draft = clone(draft)
  const logged = findOp(draft, input.opId)
  if (logged) return { draft, response: cached(draft, input.opId) }
  if (!input.content.trim()) return { draft, response: { ok: false, revision: draft.revision, note: '意见内容不能为空' } }
  commentSeq += 1
  const windowId = WINDOW_ID_RE.exec(input.anchor)?.[0]
  const conflict = draft.conflicts.find((c) => windowId && c.windowIds.includes(windowId))
  const id = `CM-${Date.now().toString(36).toUpperCase()}-${commentSeq}`
  draft.revision += 1
  draft.comments.unshift({
    id,
    channel: input.channel,
    anchor: input.anchor,
    windowId,
    conflictKey: conflict?.key,
    author: input.author,
    role: input.role,
    content: input.content,
    state: '待处理',
    createdAt: input.at,
    history: [{ state: '待处理', at: input.at, by: input.role, note: '新提交审阅意见' }],
  })
  draft.gate = deriveGate(draft)
  draft.approvedAt = undefined
  pushVersion(draft, {
    author: input.role,
    at: input.at,
    kind: '修订',
    summary: `${input.role}在 ${input.anchor} 提交新意见`,
    changes: [{ op: '意见', detail: `新增待处理意见 ${id}`, windowId }],
  })
  const response: OperationResponse = { ok: true, revision: draft.revision, note: `意见 ${id} 已进入审阅，门禁已更新` }
  logResponse(draft, { opId: input.opId, kind: 'addComment', at: input.at, response })
  return { draft, response }
}

export interface ResolveCommentInput {
  opId: string
  commentId: string
  role: Role
  at: string
}

export function resolveComment(draft: RightsDraft, input: ResolveCommentInput): { draft: RightsDraft; response: OperationResponse } {
  draft = clone(draft)
  const logged = findOp(draft, input.opId)
  if (logged) return { draft, response: cached(draft, input.opId) }
  const comment = draft.comments.find((c) => c.id === input.commentId)
  if (!comment) return { draft, response: { ok: false, revision: draft.revision, note: `意见 ${input.commentId} 不存在` } }
  if (comment.state !== '待处理') return { draft, response: { ok: false, revision: draft.revision, note: `意见已为「${comment.state}」，无需处理` } }
  draft.revision += 1
  comment.state = '已解决'
  comment.history.push({ state: '已解决', at: input.at, by: input.role, note: '审阅意见处理完成' })
  draft.gate = deriveGate(draft)
  pushVersion(draft, {
    author: input.role,
    at: input.at,
    kind: '修订',
    summary: `${input.role}处理意见 ${comment.id}`,
    changes: [{ op: '意见', detail: `${comment.anchor} 意见标记已解决，门禁同步更新`, windowId: comment.windowId }],
  })
  const response: OperationResponse = { ok: true, revision: draft.revision, note: `意见已解决，门禁已更新，r${draft.revision}` }
  logResponse(draft, { opId: input.opId, kind: 'resolveComment', at: input.at, response })
  return { draft, response }
}

export interface ApproveInput {
  opId: string
  role: Role
  at: string
}

export function approveVersion(draft: RightsDraft, input: ApproveInput): { draft: RightsDraft; response: OperationResponse } {
  draft = clone(draft)
  const logged = findOp(draft, input.opId)
  if (logged) return { draft, response: cached(draft, input.opId) }
  draft.gate = deriveGate(draft)
  if (!draft.gate.open) return { draft, response: { ok: false, revision: draft.revision, note: `审批门禁未开放：${draft.gate.blockers.map((b) => `${b.kind}×${b.count}`).join('、')}` } }
  draft.revision += 1
  for (const w of draft.windows) w.status = '已确认'
  draft.approvedAt = input.at
  pushVersion(draft, {
    author: input.role,
    at: input.at,
    kind: '审批',
    summary: `版本 r${draft.revision} 通过审批并锁定为只读`,
    changes: [{ op: '审批', detail: '全部窗口确认，版本进入只读审批' }],
  })
  const response: OperationResponse = { ok: true, revision: draft.revision, note: `r${draft.revision} 已审批锁定` }
  logResponse(draft, { opId: input.opId, kind: 'approve', at: input.at, response })
  return { draft, response }
}

export function isSchedulePatch(patch: Patch): boolean {
  return (Object.keys(patch) as WindowField[]).some((f) => SCHEDULE_FIELDS.includes(f))
}

export function fieldLabel(field: WindowField): string {
  return FIELD_LABEL[field]
}
