'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Role } from '@/lib/draft/types'

export type MutationKind = 'submitWindow' | 'resolveSource' | 'addComment' | 'resolveComment' | 'approve'

/** 失败操作入参（不含 opId，opId 单独存，重试时按原号回放） */
export type MutationInput = Record<string, unknown>

/**
 * 客户端只存“身份”和“未完成操作（outbox）”：
 *  - 权威草稿一律来自服务端 draft 查询，未拿到完整快照前不渲染业务状态（不展示半份状态）；
 *  - 写入失败的操作按原 opId 留在 outbox，可续作重试；opId 与入参持久化，刷新页面仍能对上服务端幂等日志。
 */
export interface FailedOp {
  opId: string
  kind: MutationKind
  description: string
  at: string
  retries: number
  input: MutationInput
}

interface UiState {
  role: Role
  failedOps: FailedOp[]
  seq: number
  setRole: (role: Role) => void
  nextOpId: () => string
  pushFailed: (op: Omit<FailedOp, 'retries'>) => void
  bumpRetry: (opId: string) => void
  removeFailed: (opId: string) => void
  clear: () => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      role: '海外发行',
      failedOps: [],
      seq: 1,
      setRole: (role) => set({ role }),
      nextOpId: () => {
        const seq = get().seq + 1
        set({ seq })
        return `OP-${Date.now().toString(36).toUpperCase()}-${String(seq).padStart(3, '0')}`
      },
      pushFailed: (op) => set((state) => state.failedOps.some((item) => item.opId === op.opId)
        ? state
        : { failedOps: [...state.failedOps, { ...op, retries: 0 }] }),
      bumpRetry: (opId) => set((state) => ({ failedOps: state.failedOps.map((op) => op.opId === opId ? { ...op, retries: op.retries + 1 } : op) })),
      removeFailed: (opId) => set((state) => ({ failedOps: state.failedOps.filter((op) => op.opId !== opId) })),
      clear: () => set({ failedOps: [] }),
    }),
    { name: 'yy53-rights-ui-v2', version: 2 },
  ),
)

/**
 * 统一执行一次写操作：
 * 成功 → 从 outbox 移除并返回结果；失败 → 连同原始入参记录原 opId，不做任何本地乐观覆盖。
 */
export interface MutationResult {
  ok: boolean
  revision: number
  note: string
  concurrent?: boolean
  pendingSourceId?: string
  opId: string
}

export async function runMutation<T>(args: {
  mutateAsync: (input: T & { opId: string }) => Promise<Omit<MutationResult, 'opId'>>
  input: Omit<T, 'opId'>
  kind: MutationKind
  description: string
  opId?: string
}): Promise<MutationResult> {
  const opId = args.opId ?? useUiStore.getState().nextOpId()
  try {
    const result = await args.mutateAsync({ ...(args.input as T), opId })
    useUiStore.getState().removeFailed(opId)
    return { ...result, opId }
  } catch (error) {
    // 恢复前不展示半份状态：失败操作进 outbox，界面仍以最后一次完整快照为准
    useUiStore.getState().pushFailed({ opId, kind: args.kind, description: args.description, at: new Date().toISOString(), input: args.input as MutationInput })
    return { ok: false, revision: 0, note: error instanceof Error ? error.message : '网络错误', opId }
  }
}
