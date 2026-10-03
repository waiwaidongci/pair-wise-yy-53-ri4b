import type { DraftWindow, ConflictConclusion } from './types'
import { findConflicts } from '../rules'

/**
 * 冲突结论使用稳定 key（窗口对 + 类型）。
 * 重算后：
 *  - key 仍在：结论延续，依据修订号按相关窗口的改动更新；
 *  - key 消失：旧结论失效（地区或起止日期变化导致），其关联意见同步失效。
 */
export function conflictKeyFor(aId: string, bId: string, type: string): string {
  const [x, y] = [aId, bId].sort()
  return `${x}::${y}::${type}`
}

function involvedWindowIds(conclusions: ConflictConclusion[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const c of conclusions) {
    for (const id of c.windowIds) {
      if (!map.has(c.key)) map.set(c.key, new Set())
      map.get(c.key)!.add(id)
    }
  }
  return map
}

export function recomputeConflicts(
  windows: DraftWindow[],
  previous: ConflictConclusion[],
  /** 本次发生改动（地区/起止/独占等）的窗口 id 及其落库修订号 */
  changedWindows: { id: string; revision: number }[],
): { conflicts: ConflictConclusion[]; invalidatedKeys: Set<string> } {
  const baseWindows = windows.map((w) => ({
    id: w.id,
    workId: w.workId,
    work: w.work,
    channel: w.channel,
    rights: w.rights,
    territory: w.territory,
    start: w.start,
    end: w.end,
    exclusive: w.exclusive,
    sublicense: w.sublicense,
    priority: w.priority,
    status: '草案' as const,
  }))
  const raw = findConflicts(baseWindows)
  const previousByKey = new Map(previous.map((c) => [c.key, c]))
  const changedAt = new Map(changedWindows.map((c) => [c.id, c.revision]))

  const conflicts: ConflictConclusion[] = raw.map((issue) => {
    let key: string
    switch (issue.type) {
      case '独占冲突':
        key = conflictKeyFor(issue.windowIds[0]!, issue.windowIds[1]!, '独占冲突')
        break
      case '窗口倒挂':
        key = conflictKeyFor(issue.windowIds[0]!, issue.windowIds[1]!, '窗口倒挂')
        break
      case '时间重叠':
        key = conflictKeyFor(issue.windowIds[0]!, issue.windowIds[1]!, '时间重叠')
        break
      default:
        key = conflictKeyFor(issue.windowIds[0]!, issue.windowIds[1]!, '地区交叉')
    }
    const old = previousByKey.get(key)
    let basisRevision = old?.basisRevision ?? 0
    for (const id of issue.windowIds) {
      const r = changedAt.get(id)
      if (r !== undefined && r > basisRevision) basisRevision = r
    }
    return {
      key,
      type: issue.type,
      severity: issue.severity,
      windowIds: issue.windowIds,
      title: issue.title,
      explanation: issue.explanation,
      basisRevision,
    }
  })

  const nextKeys = new Set(conflicts.map((c) => c.key))
  const previousInvolved = involvedWindowIds(previous)
  const changedIds = new Set(changedWindows.map((c) => c.id))
  const invalidatedKeys = new Set<string>()
  for (const old of previous) {
    if (nextKeys.has(old.key)) continue
    // 只有结论关联窗口确实发生过改动，才认定为“因变更而失效”
    if ([...(previousInvolved.get(old.key) ?? [])].some((id) => changedIds.has(id))) {
      invalidatedKeys.add(old.key)
    }
  }
  return { conflicts, invalidatedKeys }
}

export function conflictsForWindow(conflicts: ConflictConclusion[], windowId: string): ConflictConclusion[] {
  return conflicts.filter((c) => c.windowIds.includes(windowId))
}
