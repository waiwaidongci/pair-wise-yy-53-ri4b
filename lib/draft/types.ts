import type { RightsType, Territory } from '../types'

/** 双端角色：法务 / 海外发行 */
export type Role = '法务' | '海外发行'

export type WindowStatus = '草稿' | '审阅中' | '冲突' | '已确认'

export type WindowField =
  | 'channel'
  | 'rights'
  | 'territory'
  | 'start'
  | 'end'
  | 'exclusive'
  | 'sublicense'
  | 'priority'

/** 审阅意见状态：未处理意见随旧冲突结论失效时转为“已随变更失效”，仍留在历史可追溯 */
export type CommentState = '待处理' | '已解决' | '已随变更失效'

export type ConflictKind = '时间重叠' | '地区交叉' | '窗口倒挂' | '独占冲突'

/** 字段来源：记录该字段当前值最后由谁、在哪个修订号写入 */
export interface FieldProvenance {
  field: WindowField
  by?: Role
  revision: number
  note?: string
}

/**
 * 同一窗口两端都改过：后提交一方的补丁不覆盖先保存一方，
 * 作为“待定来源”保留，窗口退回审阅，由审阅人逐条裁决。
 */
export interface PendingSource {
  id: string
  windowId: string
  opId: string
  by: Role
  at: string
  /** 提交方打开草稿时看到的修订号 */
  baseRevision: number
  patch: Partial<Record<WindowField, string | number | boolean>>
  reason: string
  /** 先保存一方（对端）在同一窗口上已改的字段，作为另一条来源一并展示 */
  otherSide: { field: WindowField; by: Role; revision: number; value: string | number | boolean }[]
}

export interface DraftWindow {
  id: string
  workId: string
  work: string
  channel: string
  rights: RightsType
  territory: Territory
  start: string
  end: string
  exclusive: boolean
  sublicense: boolean
  priority: number
  status: WindowStatus
  /** 每个字段当前值的来源标记 */
  fields: Partial<Record<WindowField, FieldProvenance>>
}

export interface CommentHistoryEvent {
  state: CommentState
  at: string
  by: string
  note?: string
}

export interface DraftComment {
  id: string
  channel: string
  anchor: string
  /** 关联窗口（旧锚点可正则回溯） */
  windowId?: string
  /** 关联冲突结论 key；结论失效时本意见随之更新 */
  conflictKey?: string
  author: string
  role: string
  content: string
  state: CommentState
  createdAt: string
  history: CommentHistoryEvent[]
}

/** 带修订号的冲突结论：重算后同 key 结论延续，key 消失即旧结论失效 */
export interface ConflictConclusion {
  key: string
  type: ConflictKind
  severity: '高' | '中'
  windowIds: string[]
  title: string
  explanation: string
  /** 结论所依据的修订号；只有相关窗口发生改动才更新 */
  basisRevision: number
}

export type VersionKind = '修订' | '迁移' | '审批' | '退回审阅' | '来源裁决'

export interface VersionChange {
  op: string
  detail: string
  windowId?: string
  field?: WindowField
}

export interface VersionRecord {
  revision: number
  author: string
  at: string
  summary: string
  kind: VersionKind
  changes: VersionChange[]
}

export interface GateBlocker {
  kind: '高危冲突' | '待处理意见' | '退回审阅' | '待定来源'
  count: number
  detail: string
}

export interface ApprovalGate {
  open: boolean
  blockers: GateBlocker[]
}

/** 幂等操作日志：写入失败后按同一 opId 重试，不会重复落库 */
export interface OpLogEntry {
  opId: string
  kind: 'submit' | 'resolveComment' | 'addComment' | 'resolveSource' | 'approve'
  at: string
  response: OperationResponse
}

export interface OperationResponse {
  ok: boolean
  revision: number
  note: string
  concurrent?: boolean
  pendingSourceId?: string
}

export interface RightsDraft {
  /** 修订号：打开草稿必带；旧稿迁移后获得 */
  revision: number
  windows: DraftWindow[]
  comments: DraftComment[]
  conflicts: ConflictConclusion[]
  versions: VersionRecord[]
  pendingSources: PendingSource[]
  gate: ApprovalGate
  opLog: OpLogEntry[]
  approvedAt?: string
  migratedFromLegacy: boolean
  migratedAt?: string
}
