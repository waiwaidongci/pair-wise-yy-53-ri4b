import type { LicenseWindow, RightsComment, DraftVersion } from '../types'
import type {
  CommentHistoryEvent,
  ConflictConclusion,
  DraftComment,
  DraftWindow,
  FieldProvenance,
  RightsDraft,
  WindowField,
  WindowStatus,
} from './types'
import { recomputeConflicts } from './conflicts'

const WINDOW_FIELDS: WindowField[] = ['channel', 'rights', 'territory', 'start', 'end', 'exclusive', 'sublicense', 'priority']

export function provenance(field: WindowField, revision: number, note?: string): FieldProvenance {
  return { field, revision, note }
}

/** 迁移后窗口状态映射；迁移完成后再按冲突结果统一覆盖 */
function mapLegacyStatus(status: LicenseWindow['status']): WindowStatus {
  if (status === '冲突' || status === '已确认') return status
  return '草稿'
}

export function migrateWindow(win: LicenseWindow): DraftWindow {
  const fields = {} as DraftWindow['fields']
  for (const f of WINDOW_FIELDS) fields[f] = provenance(f, 0, '旧稿迁移')
  return {
    id: win.id,
    workId: win.workId,
    work: win.work,
    channel: win.channel,
    rights: win.rights,
    territory: win.territory,
    start: win.start,
    end: win.end,
    exclusive: win.exclusive,
    sublicense: win.sublicense,
    priority: win.priority,
    status: mapLegacyStatus(win.status),
    fields,
  }
}

const windowIdInAnchor = /RW-\d+/

export function migrateComment(comment: RightsComment, at: string): DraftComment {
  const windowId = windowIdInAnchor.exec(comment.anchor)?.[0]
  const history: CommentHistoryEvent[] = [{
    state: comment.resolved ? '已解决' : '待处理',
    at,
    by: comment.resolved ? comment.author : '系统',
    note: '旧稿迁移，历史意见保留',
  }]
  return {
    id: comment.id,
    channel: comment.channel,
    anchor: comment.anchor,
    windowId,
    conflictKey: undefined, // 迁移时按锚点回溯绑定到当前冲突结论（见 bindComments）
    author: comment.author,
    role: comment.role,
    content: comment.content,
    state: comment.resolved ? '已解决' : '待处理',
    createdAt: at,
    history,
  }
}

/**
 * 将意见按锚点回溯绑定到冲突结论：
 * 仅当锚点明显指向冲突语义（独占尾部/倒挂/重叠/顺延/开窗等）时才绑定，
 * 不依据正文字词（正文提到“独占/不冲突”不等于该意见针对冲突结论），
 * 避免把“物料拆分”等独立意见错误挂到冲突结论上而被联动失效；
 * 一个窗口参与多条冲突时，高严重度优先。
 */
const CONFLICT_ANCHOR = /独占|倒挂|重叠|顺延|开窗|冲突/
export function bindComments(comments: DraftComment[], conflicts: ConflictConclusion[]): DraftComment[] {
  return comments.map((comment) => {
    if (comment.conflictKey || !comment.windowId) return comment
    if (!CONFLICT_ANCHOR.test(comment.anchor)) return comment
    const related = conflicts
      .filter((c) => c.windowIds.includes(comment.windowId!))
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === '高' ? -1 : 1))
    const target = related[0]
    return target ? { ...comment, conflictKey: target.key, history: [...comment.history, { state: comment.state, at: comment.createdAt, by: '系统', note: `回溯绑定冲突结论 ${target.key}` }] } : comment
  })
}

function migrateVersions(versions: DraftVersion[], at: string): RightsDraft['versions'] {
  return versions.map((v) => ({
    revision: 0,
    author: v.author,
    at,
    summary: v.summary,
    kind: '迁移' as const,
    changes: v.changes.map((detail) => ({ op: '历史记录', detail })),
  }))
}

export interface LegacyDraft {
  windows: LicenseWindow[]
  comments: RightsComment[]
  versions?: DraftVersion[]
}

/**
 * 旧稿迁移：缺修订号的旧结构获得 revision=1 起步结构，
 * 历史意见保留完整轨迹，迁移本身写入版本记录。
 */
export function migrateDraft(legacy: LegacyDraft, at: string): RightsDraft {
  const windows = legacy.windows.map(migrateWindow)
  const { conflicts } = recomputeConflicts(windows, [], [])
  // 迁移不视为“改动导致失效”，迁移前已存在的冲突结论依据记为修订 1
  const seededConflicts = conflicts.map((c) => ({ ...c, basisRevision: 1 }))
  const comments = bindComments(
    legacy.comments.map((c) => migrateComment(c, at)),
    seededConflicts,
  )
  const draft: RightsDraft = {
    revision: 1,
    windows,
    comments,
    conflicts: seededConflicts,
    versions: [],
    pendingSources: [],
    gate: { open: false, blockers: [] },
    opLog: [],
    migratedFromLegacy: true,
    migratedAt: at,
  }
  draft.versions = [
    {
      revision: 1,
      author: '系统迁移',
      at,
      kind: '迁移',
      summary: '旧稿迁移到带修订号的双端草稿结构（授权窗口 / 审阅意见 / 版本记录）',
      changes: [
        { op: '迁移', detail: `迁移窗口 ${windows.length} 条，独占标记原样保留不覆盖` },
        { op: '迁移', detail: `迁移历史意见 ${comments.length} 条，按锚点回溯绑定冲突结论` },
        { op: '迁移', detail: '修订号从 r1 开始，后续提交只写自己改过的字段' },
      ],
    },
    ...migrateVersions(legacy.versions ?? [], at),
  ]
  return draft
}
