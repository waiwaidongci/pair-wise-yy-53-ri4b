import type { ApprovalGate, DraftOp, DraftState, DraftVersion, LicenseWindow, ReviewItem, RightsComment, Role, SubmitResult } from './types'
import { findConflicts, shiftWindow } from './rules'
import { initialComments, initialWindows, versions as mockVersions } from './mock-data'

export const FIELD_LABELS: Record<string, string> = {
  channel: '渠道',
  rights: '权利类型',
  territory: '地区',
  start: '开始日期',
  end: '结束日期',
  exclusive: '独占标记',
  sublicense: '次级授权',
  priority: '优先顺序',
  status: '状态',
}

/** 生成稳定操作号：写入失败后按同一操作号重试，服务端据此幂等去重 */
export function genOpId(): string {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function cloneWindows(windows: LicenseWindow[]): LicenseWindow[] {
  return windows.map((w) => ({ ...w }))
}
export function cloneComments(comments: RightsComment[]): RightsComment[] {
  return comments.map((c) => ({ ...c }))
}

const EDITABLE_FIELDS = ['channel', 'rights', 'territory', 'start', 'end', 'exclusive', 'sublicense', 'priority'] as const

/** 字段级 diff：提交只写自己改过的字段，绝不整对象覆盖 */
export function diffWindowPatch(before: LicenseWindow, after: LicenseWindow): Partial<LicenseWindow> {
  const patch: Record<string, unknown> = {}
  for (const key of EDITABLE_FIELDS) {
    if (after[key] !== before[key]) patch[key] = after[key]
  }
  return patch as Partial<LicenseWindow>
}

/** 窗口条款变化是否影响冲突结论（地区 / 起止日期 / 独占） */
export function affectsConflict(patch: Partial<LicenseWindow>): boolean {
  return ['territory', 'start', 'end', 'exclusive'].some((k) => k in patch)
}

/** 从意见锚点（如「RW-101 · 院线独占尾部」）取出窗口号 */
export function anchorWindowId(anchor: string): string | undefined {
  const match = /^(RW-\d+)/.exec(anchor.trim())
  return match?.[1]
}

export function computeGate(windows: LicenseWindow[], comments: RightsComment[], reviewItems: ReviewItem[]): ApprovalGate {
  const blockers: string[] = []
  const conflicts = findConflicts(windows)
  if (conflicts.some((c) => c.severity === '高')) blockers.push('存在高严重度冲突，阻止审批通过')
  if (reviewItems.some((r) => r.status === '待审阅')) blockers.push('存在双端来源冲突待审阅')
  if (comments.some((c) => !c.resolved)) blockers.push('存在未处理意见')
  return { status: blockers.length ? '审批中' : '可批准', blockers }
}

/**
 * 地区或起止日期一变：旧冲突结论失效重算，
 * 未处理意见标记待复核，版本审批门禁跟着更新。
 */
export function recompute(draft: DraftState, staleWindowIds?: Set<string>): void {
  const conflicts = findConflicts(draft.windows)
  const conflictWindowIds = new Set(conflicts.flatMap((c) => c.windowIds))
  for (const win of draft.windows) {
    if (conflictWindowIds.has(win.id)) win.status = '冲突'
  }
  if (staleWindowIds && staleWindowIds.size) {
    for (const comment of draft.comments) {
      if (comment.resolved) continue
      const winId = anchorWindowId(comment.anchor)
      if (winId && staleWindowIds.has(winId)) comment.stale = true
    }
  }
  draft.gate = computeGate(draft.windows, draft.comments, draft.reviewItems)
}

/** 服务端记录每个窗口最后一次字段级修改（用于双来源追溯） */
export interface WindowPatchEntry {
  opId: string
  patch: Partial<LicenseWindow>
  actor: string
  role: Role
  at: string
  rev: number
}

export interface ApplyResult {
  draft: DraftState
  appliedOpIds: string[]
  skippedOpIds: string[]
  newReviewItems: ReviewItem[]
  version?: DraftVersion
  processed: boolean
}

function describePatch(win: LicenseWindow, patch: Partial<LicenseWindow>): string {
  const parts = Object.keys(patch).map((key) => {
    const value = (patch as Record<string, unknown>)[key]
    const text = key === 'exclusive' ? (value ? '是' : '否') : String(value)
    return `${FIELD_LABELS[key] ?? key} → ${text}`
  })
  return `${win.id} ${win.work} ${win.channel}：${parts.join('，')}`
}

function buildVersion(ops: DraftOp[], revision: number, windows: LicenseWindow[]): DraftVersion {
  const actor = ops[0]!.actor
  const changes: string[] = []
  for (const op of ops) {
    if (op.kind === 'window:update') {
      const win = windows.find((w) => w.id === op.windowId)
      if (win) changes.push(describePatch(win, op.patch))
    } else if (op.kind === 'window:batchShift') {
      changes.push(`批量顺延 ${op.windowIds.length} 个窗口 ${op.days > 0 ? '+' : ''}${op.days} 天`)
    } else if (op.kind === 'comment:resolve') {
      changes.push(`意见 ${op.commentId} 标记为已解决`)
    } else if (op.kind === 'comment:add') {
      changes.push(`新增审阅意见：${op.comment.content.slice(0, 24)}`)
    }
  }
  return { id: `v${revision}`, author: actor, time: nowIso(), summary: '双端合并提交', changes, rev: revision }
}

/**
 * 把字段级操作合并进草稿。
 * - 提交只写自己改过的字段（patch 浅合并）
 * - 同一窗口两边都改过 → 留两条来源并退回审阅，不覆盖独占标记
 * - 地区/起止日期变化 → 重算冲突、未处理意见与门禁
 */
export function applyOps(
  draft: DraftState,
  ops: DraftOp[],
  baseRevision: number,
  windowLastPatch: Map<string, WindowPatchEntry>,
  appliedOpIds: Set<string>,
): ApplyResult {
  const next: DraftState = {
    ...draft,
    windows: cloneWindows(draft.windows),
    comments: cloneComments(draft.comments),
    versions: draft.versions.map((v) => ({ ...v, changes: [...v.changes] })),
    reviewItems: draft.reviewItems.map((r) => ({ ...r, sources: [...r.sources] as [typeof r.sources[0], typeof r.sources[1]] })),
    gate: { ...draft.gate, blockers: [...draft.gate.blockers] },
  }
  const appliedOpIdsList: string[] = []
  const skippedOpIds: string[] = []
  const newReviewItems: ReviewItem[] = []
  const staleWindowIds = new Set<string>()
  let processed = false

  const newRevision = next.revision + (ops.some((op) => !appliedOpIds.has(op.opId)) ? 1 : 0)

  for (const op of ops) {
    if (appliedOpIds.has(op.opId)) {
      skippedOpIds.push(op.opId)
      continue
    }
    processed = true

    if (op.kind === 'window:update' || op.kind === 'window:batchShift') {
      const targets = op.kind === 'window:update' ? [op.windowId] : op.windowIds
      for (const winId of targets) {
        const win = next.windows.find((w) => w.id === winId)
        if (!win) continue
        const patch: Partial<LicenseWindow> = op.kind === 'window:update' ? op.patch : { start: shiftWindow(win, op.days).start, end: shiftWindow(win, op.days).end }
        const last = windowLastPatch.get(winId)
        const dualSource = !!last && last.rev > baseRevision && last.role !== op.role
        if (dualSource && last) {
          // 同一窗口两边都改过：留两条来源，退回审阅，不覆盖独占标记
          const sourceA = { opId: last.opId, actor: last.actor, role: last.role, at: last.at, patch: last.patch }
          const sourceB = { opId: op.opId, actor: op.actor, role: op.role, at: op.at, patch }
          const item: ReviewItem = {
            id: `RV-${winId}-${op.opId}`,
            windowId: winId,
            windowLabel: `${win.id} ${win.work} ${win.channel}`,
            current: { ...win },
            sources: [sourceA, sourceB],
            status: '待审阅',
            createdAt: op.at,
          }
          next.reviewItems.unshift(item)
          newReviewItems.push(item)
        } else {
          Object.assign(win, patch, { modifiedBy: op.actor, modifiedRev: newRevision })
          windowLastPatch.set(winId, { opId: op.opId, patch, actor: op.actor, role: op.role, at: op.at, rev: newRevision })
          if (affectsConflict(patch)) staleWindowIds.add(winId)
        }
      }
    } else if (op.kind === 'comment:resolve') {
      const comment = next.comments.find((c) => c.id === op.commentId)
      if (comment) {
        comment.resolved = true
        comment.stale = false
      }
    } else if (op.kind === 'comment:add') {
      if (!next.comments.some((c) => c.id === op.comment.id)) next.comments.unshift({ ...op.comment })
    }

    appliedOpIds.add(op.opId)
    appliedOpIdsList.push(op.opId)
  }

  if (processed) {
    next.revision = newRevision
    recompute(next, staleWindowIds)
    next.versions.unshift(buildVersion(ops, newRevision, next.windows))
  }

  return { draft: next, appliedOpIds: appliedOpIdsList, skippedOpIds, newReviewItems, processed }
}

/** 审阅中采用某一条来源（人工选择，独占标记仅在明确采纳时变更） */
export function adoptReview(
  draft: DraftState,
  reviewItemId: string,
  sourceIndex: 0 | 1,
  windowLastPatch: Map<string, WindowPatchEntry>,
): { draft: DraftState; applied: boolean } {
  const item = draft.reviewItems.find((r) => r.id === reviewItemId)
  if (!item || item.status !== '待审阅') return { draft, applied: false }
  const next: DraftState = {
    ...draft,
    windows: cloneWindows(draft.windows),
    comments: cloneComments(draft.comments),
    reviewItems: draft.reviewItems.map((r) => ({ ...r, sources: [...r.sources] as [typeof r.sources[0], typeof r.sources[1]] })),
    gate: { ...draft.gate, blockers: [...draft.gate.blockers] },
  }
  const target = next.reviewItems.find((r) => r.id === reviewItemId)!
  const src = target.sources[sourceIndex]!
  const win = next.windows.find((w) => w.id === target.windowId)
  if (win) {
    const rev = next.revision + 1
    Object.assign(win, src.patch, { modifiedBy: src.actor, modifiedRev: rev })
    windowLastPatch.set(win.id, { opId: src.opId, patch: src.patch, actor: src.actor, role: src.role, at: src.at, rev })
    target.status = sourceIndex === 0 ? '已采用来源一' : '已采用来源二'
    next.revision = rev
    recompute(next, new Set([win.id]))
  }
  return { draft: next, applied: true }
}

/** 全新草稿（服务端种子 + 客户端默认） */
export function seedDraft(): DraftState {
  const windows = initialWindows.map((w) => ({ ...w, modifiedBy: '初始稿', modifiedRev: 18 }))
  const comments = initialComments.map((c) => ({ ...c }))
  const versions = mockVersions.map((v, i) => ({ ...v, rev: 18 - i }))
  const reviewItems: ReviewItem[] = []
  return { revision: 18, windows, comments, versions, reviewItems, gate: computeGate(windows, comments, reviewItems) }
}

/**
 * 旧稿缺修订号 → 迁移到当前结构，历史意见仍可追溯。
 * 旧结构形如 { windows, comments, version, ... }（无 revision）。
 */
export function migrateDraft(persisted: unknown): DraftState {
  if (persisted && typeof persisted === 'object' && typeof (persisted as DraftState).revision === 'number' && Array.isArray((persisted as DraftState).windows)) {
    const d = persisted as DraftState
    const windows = d.windows.map((w) => ({ ...w, modifiedBy: w.modifiedBy ?? '初始稿', modifiedRev: w.modifiedRev ?? d.revision }))
    const comments = d.comments.map((c) => ({ ...c }))
    const reviewItems = d.reviewItems ?? []
    return { ...d, windows, comments, reviewItems, versions: d.versions ?? [], gate: computeGate(windows, comments, reviewItems) }
  }
  const old = (persisted ?? {}) as { windows?: LicenseWindow[]; comments?: RightsComment[]; version?: number }
  const revision = typeof old.version === 'number' ? old.version : 18
  const windows = (old.windows ?? initialWindows).map((w) => ({ ...w, modifiedBy: w.modifiedBy ?? '迁移稿', modifiedRev: w.modifiedRev ?? revision }))
  const comments = (old.comments ?? initialComments).map((c) => ({ ...c, migrated: true }))
  const versions = mockVersions.map((v, i) => ({ ...v, rev: revision - i }))
  const reviewItems: ReviewItem[] = []
  return { revision, windows, comments, versions, reviewItems, gate: computeGate(windows, comments, reviewItems) }
}

export function emptySubmitResult(revision: number): SubmitResult {
  return { ok: true, revision, appliedOpIds: [], skippedOpIds: [], newReviewItems: [], reviewItems: [], gate: { status: '审批中', blockers: [] } }
}
