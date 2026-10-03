export type RightsType = '院线' | '电视' | '流媒体' | '航空' | '非院线'
export type Territory = '中国大陆' | '中国香港' | '中国台湾' | '新加坡' | '马来西亚' | '东南亚区域' | '北美'
export type Role = '法务' | '发行'

export interface LicenseWindow {
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
  status: '草案' | '冲突' | '已确认'
  /** 最后修改人（双端来源追溯） */
  modifiedBy?: string
  /** 最后修改时的修订号 */
  modifiedRev?: number
}

export interface RightsComment {
  id: string
  channel: string
  anchor: string
  author: string
  role: string
  content: string
  resolved: boolean
  /** 地区/日期变更后需重新确认的未处理意见 */
  stale?: boolean
  /** 由旧稿迁移而来，保留历史可追溯 */
  migrated?: boolean
}

export interface DraftVersion {
  id: string
  author: string
  time: string
  summary: string
  changes: string[]
  rev?: number
}

/** 双端来源中的一条：一方对某窗口提交的字段级修改 */
export interface DraftSource {
  opId: string
  actor: string
  role: Role
  at: string
  patch: Partial<LicenseWindow>
}

/** 双来源审阅条目：同一窗口两边都改过，留两条来源并退回审阅 */
export interface ReviewItem {
  id: string
  windowId: string
  windowLabel: string
  /** 退回审阅时线上生效的窗口（来源一已应用的状态） */
  current: LicenseWindow
  sources: [DraftSource, DraftSource]
  status: '待审阅' | '已采用来源一' | '已采用来源二'
  createdAt: string
}

/** 字段级操作：提交只写自己改过的字段 */
export type DraftOp =
  | { opId: string; kind: 'window:update'; windowId: string; patch: Partial<LicenseWindow>; actor: string; role: Role; at: string }
  | { opId: string; kind: 'window:batchShift'; windowIds: string[]; days: number; actor: string; role: Role; at: string }
  | { opId: string; kind: 'comment:resolve'; commentId: string; actor: string; role: Role; at: string }
  | { opId: string; kind: 'comment:add'; comment: RightsComment; actor: string; role: Role; at: string }

export interface ApprovalGate {
  status: '审批中' | '可批准'
  blockers: string[]
}

export interface DraftState {
  /** 修订号：打开草稿时携带，提交时作为基线 */
  revision: number
  windows: LicenseWindow[]
  comments: RightsComment[]
  versions: DraftVersion[]
  reviewItems: ReviewItem[]
  gate: ApprovalGate
}

export interface SubmitResult {
  ok: boolean
  revision: number
  /** 已应用的操作号 */
  appliedOpIds: string[]
  /** 幂等去重：已应用过而跳过的操作号 */
  skippedOpIds: string[]
  /** 本次新产生的双来源冲突 */
  newReviewItems: ReviewItem[]
  /** 仍待审阅的双来源条目 */
  reviewItems: ReviewItem[]
  gate: ApprovalGate
  version?: DraftVersion
  /** 模拟写入失败时返回，未应用任何字段 */
  error?: string
}
