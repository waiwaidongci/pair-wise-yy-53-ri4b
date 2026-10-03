'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DraftOp, DraftState, LicenseWindow, RightsComment, Role } from '@/lib/types'
import { diffWindowPatch, genOpId, migrateDraft, nowIso, seedDraft } from '@/lib/draft'
import { findConflicts } from '@/lib/rules'
import { initialComments, initialWindows } from '@/lib/mock-data'
import { trpcClient } from '@/trpc/client'

export const ROLE_ACTOR: Record<Role, string> = { 法务: '黎清', 发行: '章宁' }

/** 合并某窗口所有未提交的字段级 patch（只写自己改过的字段） */
export function pendingPatchFor(ops: DraftOp[], windowId: string): Partial<LicenseWindow> {
  const merged: Record<string, unknown> = {}
  for (const op of ops) {
    if (op.kind === 'window:update' && op.windowId === windowId) Object.assign(merged, op.patch)
  }
  return merged as Partial<LicenseWindow>
}

/** 在权威草稿上叠加未提交改动，仅用于表单预览（明确标注「未提交」，不作已保存状态） */
export function displayWindows(draft: DraftState, ops: DraftOp[]): LicenseWindow[] {
  return draft.windows.map((w) => ({ ...w, ...pendingPatchFor(ops, w.id) }))
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface RightsState {
  draft: DraftState
  pendingOps: DraftOp[]
  role: Role
  status: 'idle' | 'saving' | 'error'
  error?: string
  retryCount: number
  setRole: (role: Role) => void
  editWindow: (id: string, patch: Partial<LicenseWindow>) => void
  batchShift: (ids: string[], days: number) => void
  resolveComment: (id: string) => void
  addComment: (content: string, anchor: string) => void
  submit: () => Promise<void>
  retry: () => Promise<void>
  adoptReview: (reviewItemId: string, sourceIndex: 0 | 1) => Promise<void>
  loadDraft: () => Promise<void>
  loadLegacyDraft: () => void
  resetAll: () => Promise<void>
}

export const useRightsStore = create<RightsState>()(
  persist(
    (set, get) => ({
      draft: seedDraft(),
      pendingOps: [],
      role: '法务',
      status: 'idle',
      error: undefined,
      retryCount: 0,

      setRole: (role) => set({ role }),

      editWindow: (id, patch) =>
        set((state) => {
          const win = state.draft.windows.find((w) => w.id === id)
          if (!win) return state
          const existing = pendingPatchFor(state.pendingOps, id)
          const merged = { ...existing, ...patch }
          const clean = diffWindowPatch(win, { ...win, ...merged })
          const pendingOps = state.pendingOps.filter((op) => !(op.kind === 'window:update' && op.windowId === id))
          if (Object.keys(clean).length) {
            const now = nowIso()
            pendingOps.push({ opId: genOpId(), kind: 'window:update', windowId: id, patch: clean, actor: ROLE_ACTOR[state.role], role: state.role, at: now })
          }
          return { pendingOps }
        }),

      batchShift: (ids, days) =>
        set((state) => {
          if (!ids.length) return state
          const now = nowIso()
          const op: DraftOp = { opId: genOpId(), kind: 'window:batchShift', windowIds: ids, days, actor: ROLE_ACTOR[state.role], role: state.role, at: now }
          return { pendingOps: [...state.pendingOps, op] }
        }),

      resolveComment: (id) =>
        set((state) => {
          if (state.pendingOps.some((op) => op.kind === 'comment:resolve' && op.commentId === id)) return state
          const now = nowIso()
          const op: DraftOp = { opId: genOpId(), kind: 'comment:resolve', commentId: id, actor: ROLE_ACTOR[state.role], role: state.role, at: now }
          return { pendingOps: [...state.pendingOps, op] }
        }),

      addComment: (content, anchor) =>
        set((state) => {
          const now = nowIso()
          const comment: RightsComment = {
            id: `CM-${Date.now()}`,
            channel: anchor.split('·')[0]?.trim() ?? '',
            anchor,
            author: ROLE_ACTOR[state.role],
            role: state.role,
            content,
            resolved: false,
          }
          const op: DraftOp = { opId: genOpId(), kind: 'comment:add', comment, actor: ROLE_ACTOR[state.role], role: state.role, at: now }
          return { pendingOps: [...state.pendingOps, op] }
        }),

      submit: async () => {
        const { pendingOps, draft } = get()
        if (!pendingOps.length) return
        const baseRevision = draft.revision
        const ops = pendingOps
        set({ status: 'saving', error: undefined, retryCount: 0 })
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const result = await trpcClient.draft.submit.mutate({ baseRevision, ops })
            if (result.ok) {
              const fresh = await trpcClient.draft.get.query()
              set({ draft: fresh, pendingOps: [], status: 'idle', error: undefined, retryCount: 0 })
              return
            }
            set({ status: 'saving', error: result.error ?? '写入失败', retryCount: attempt })
          } catch (err) {
            set({ status: 'saving', error: err instanceof Error ? err.message : '网络错误', retryCount: attempt })
          }
          await delay(500 * attempt)
        }
        set({ status: 'error', error: get().error ?? '写入失败，可按原操作号重试', retryCount: 3 })
      },

      retry: async () => {
        set({ status: 'saving', error: undefined, retryCount: 0 })
        await get().submit()
      },

      adoptReview: async (reviewItemId, sourceIndex) => {
        try {
          const result = await trpcClient.draft.adoptReview.mutate({ reviewItemId, sourceIndex })
          if (result.ok) {
            const fresh = await trpcClient.draft.get.query()
            set({ draft: fresh })
          }
        } catch (err) {
          set({ status: 'error', error: err instanceof Error ? err.message : '审阅采纳失败' })
        }
      },

      loadDraft: async () => {
        try {
          const fresh = await trpcClient.draft.get.query()
          set({ draft: fresh })
        } catch {
          /* 保留本地持久化草稿，待网络恢复 */
        }
      },

      loadLegacyDraft: () => {
        const legacy = { windows: initialWindows, comments: initialComments, version: 16 }
        set({ draft: migrateDraft(legacy), pendingOps: [], status: 'idle', error: undefined, retryCount: 0 })
      },

      resetAll: async () => {
        await trpcClient.draft.reset.mutate()
        const fresh = await trpcClient.draft.get.query()
        set({ draft: fresh, pendingOps: [], status: 'idle', error: undefined, retryCount: 0 })
      },
    }),
    {
      name: 'yy53-rights-draft-v1',
      version: 2,
      partialize: (state) => ({ draft: state.draft, pendingOps: state.pendingOps, role: state.role }),
      migrate: (persisted) => {
        const p = persisted as { draft?: DraftState; pendingOps?: DraftOp[]; role?: Role } | null
        if (p && p.draft) return { draft: migrateDraft(p.draft), pendingOps: p.pendingOps ?? [], role: p.role ?? '法务' }
        return { draft: migrateDraft(persisted), pendingOps: [], role: '法务' }
      },
    },
  ),
)

/** 兼容旧 hook 名 */
export function useConflicts() {
  const windows = useRightsStore((state) => state.draft.windows)
  // 冲突由权威草稿 recompute 后随 gate 一起返回；这里同步计算用于即时展示
  return findConflicts(windows)
}
