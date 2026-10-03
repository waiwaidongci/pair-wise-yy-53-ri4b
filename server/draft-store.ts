import { initialComments, initialWindows, versions } from '@/lib/mock-data'
import { migrateDraft } from '@/lib/draft/migrate'
import {
  addComment,
  approveVersion,
  resolveComment,
  resolvePendingSource,
  submitWindow,
  type ApproveInput,
  type CommentInput,
  type ResolveCommentInput,
  type ResolveSourceInput,
  type SubmitInput,
} from '@/lib/draft/engine'
import type { RightsDraft } from '@/lib/draft/types'

/**
 * 服务端权威草稿（演示用进程内存储）：
 *  - 首次加载自动把缺修订号的旧稿迁移到当前结构；
 *  - 所有变更走纯函数引擎，调用方拿到的永远是完整快照（写入失败不暴露半份状态）；
 *  - failNextN 用于演示“写入失败”：在任何状态变更前抛错，重试按原 opId 幂等。
 */
declare global {
  // eslint-disable-next-line no-var
  var __RIGHTS_DRAFT_STORE__: DraftStore | undefined
}

class DraftStore {
  private draft: RightsDraft
  private failNextN = 0

  constructor() {
    this.draft = migrateDraft({ windows: initialWindows, comments: initialComments, versions }, new Date('2026-10-03T09:00:00+08:00').toISOString())
  }

  snapshot(): RightsDraft {
    return structuredClone(this.draft)
  }

  injectFailure(n = 1) {
    this.failNextN += n
    return { ok: true as const, failNextN: this.failNextN }
  }

  private maybeFail() {
    if (this.failNextN > 0) {
      this.failNextN -= 1
      throw new Error('模拟写入失败：草稿未变更，请按原操作号重试')
    }
  }

  private run<T extends { opId: string }>(input: T, apply: (draft: RightsDraft, input: T) => { draft: RightsDraft; response: { ok: boolean; revision: number; note: string } }) {
    // 幂等重试不视为新写入：已登记操作即使失败注入开启也直接回放
    const already = this.draft.opLog.find((entry) => entry.opId === input.opId)
    if (already) return { ...already.response }
    this.maybeFail()
    const result = apply(this.draft, input)
    this.draft = result.draft
    return result.response
  }

  submit(input: SubmitInput) {
    return this.run(input, submitWindow)
  }

  resolveSource(input: ResolveSourceInput) {
    return this.run(input, resolvePendingSource)
  }

  addComment(input: CommentInput) {
    return this.run(input, addComment)
  }

  resolveComment(input: ResolveCommentInput) {
    return this.run(input, resolveComment)
  }

  approve(input: ApproveInput) {
    return this.run(input, approveVersion)
  }

  reset() {
    this.draft = migrateDraft({ windows: initialWindows, comments: initialComments, versions }, new Date('2026-10-03T09:00:00+08:00').toISOString())
    this.failNextN = 0
    return this.snapshot()
  }
}

const store = globalThis.__RIGHTS_DRAFT_STORE__ ?? new DraftStore()
if (process.env.NODE_ENV !== 'production' && !globalThis.__RIGHTS_DRAFT_STORE__) {
  globalThis.__RIGHTS_DRAFT_STORE__ = store
}

export { store as draftStore }
