import { adoptReview, applyOps, seedDraft, type WindowPatchEntry } from '@/lib/draft'
import type { DraftOp, DraftState, SubmitResult } from '@/lib/types'

/** 服务端维护权威草稿：修订号、操作幂等去重、双端来源追溯 */
let draft: DraftState = seedDraft()
const appliedOpIds = new Set<string>()
const windowLastPatch = new Map<string, WindowPatchEntry>()
/** 演示用：置位后下一次写入失败且不应用任何字段，随后按原操作号重试成功 */
let forceFailNext = false

export function getDraft(): DraftState {
  return draft
}

export function submitOps(input: { baseRevision: number; ops: DraftOp[] }): SubmitResult {
  if (forceFailNext) {
    forceFailNext = false
    return {
      ok: false,
      revision: draft.revision,
      appliedOpIds: [],
      skippedOpIds: [],
      newReviewItems: [],
      reviewItems: draft.reviewItems.filter((r) => r.status === '待审阅'),
      gate: draft.gate,
      error: '模拟写入失败：服务端未应用任何字段，可按原操作号重试',
    }
  }
  const result = applyOps(draft, input.ops, input.baseRevision, windowLastPatch, appliedOpIds)
  draft = result.draft
  return {
    ok: true,
    revision: draft.revision,
    appliedOpIds: result.appliedOpIds,
    skippedOpIds: result.skippedOpIds,
    newReviewItems: result.newReviewItems,
    reviewItems: draft.reviewItems.filter((r) => r.status === '待审阅'),
    gate: draft.gate,
    version: result.version,
  }
}

export function adoptReviewItem(input: { reviewItemId: string; sourceIndex: 0 | 1 }): SubmitResult {
  const result = adoptReview(draft, input.reviewItemId, input.sourceIndex, windowLastPatch)
  if (result.applied) draft = result.draft
  return {
    ok: result.applied,
    revision: draft.revision,
    appliedOpIds: [],
    skippedOpIds: [],
    newReviewItems: [],
    reviewItems: draft.reviewItems.filter((r) => r.status === '待审阅'),
    gate: draft.gate,
  }
}

export function setForceFail(value: boolean): boolean {
  forceFailNext = value
  return forceFailNext
}

export function resetDraft(): DraftState {
  draft = seedDraft()
  appliedOpIds.clear()
  windowLastPatch.clear()
  forceFailNext = false
  return draft
}
