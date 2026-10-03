'use client'

import { useToast } from '@chakra-ui/react'
import { useCallback } from 'react'
import { trpc } from '@/trpc/client'
import { runMutation, useUiStore, type FailedOp, type MutationResult } from '@/store/ui'
import type { Role } from '@/lib/draft/types'

type SubmitVars = Omit<Parameters<ReturnType<typeof trpc.submitWindow.useMutation>['mutateAsync']>[0], 'opId'>
type SourceVars = Omit<Parameters<ReturnType<typeof trpc.resolveSource.useMutation>['mutateAsync']>[0], 'opId'>
type CommentVars = Omit<Parameters<ReturnType<typeof trpc.addComment.useMutation>['mutateAsync']>[0], 'opId'>
type ResolveCommentVars = Omit<Parameters<ReturnType<typeof trpc.resolveComment.useMutation>['mutateAsync']>[0], 'opId'>

const now = () => new Date().toISOString()

function isWriteFailure(note: string) {
  return note.includes('写入失败') || note.includes('网络') || note.includes('fetch')
}

export function useDraftActions() {
  const toast = useToast()
  const utils = trpc.useUtils()
  const role = useUiStore((state) => state.role)
  const removeFailed = useUiStore((state) => state.removeFailed)
  const submit = trpc.submitWindow.useMutation()
  const resolveSource = trpc.resolveSource.useMutation()
  const addComment = trpc.addComment.useMutation()
  const resolveComment = trpc.resolveComment.useMutation()

  const refresh = useCallback(() => utils.draft.invalidate(), [utils])

  const submitPatch = useCallback(async (
    windowId: string,
    baseRevision: number,
    patch: Partial<Record<string, string | number | boolean>>,
    opId?: string,
  ): Promise<MutationResult> => {
    const result = await runMutation<SubmitVars>({
      mutateAsync: submit.mutateAsync,
      kind: 'submitWindow',
      description: `${role}修订窗口 ${windowId}（基于 r${baseRevision}）`,
      opId,
      input: { role, baseRevision, windowId, patch: patch as SubmitVars['patch'], at: now() },
    })
    if (result.ok) {
      refresh()
      if (result.concurrent) toast({ title: '同一窗口两端都改过', description: `${result.note} 两条来源已保留并退回审阅。`, status: 'warning', duration: 6000 })
      else toast({ title: '字段已写入', description: result.note, status: 'success' })
    } else if (isWriteFailure(result.note)) {
      toast({ title: '写入失败', description: '操作已保留在顶部续作条，可按原操作号重试。', status: 'error', duration: 6000 })
    } else {
      toast({ title: '提交被拒绝', description: result.note, status: 'error' })
    }
    return result
  }, [role, submit, refresh, toast])

  const decideSource = useCallback(async (sourceId: string, decision: SourceVars['decision'], opId?: string): Promise<MutationResult> => {
    const result = await runMutation<SourceVars>({
      mutateAsync: resolveSource.mutateAsync,
      kind: 'resolveSource',
      description: `${role}${decision}待定来源 ${sourceId}`,
      opId,
      input: { sourceId, role, decision, at: now() },
    })
    if (result.ok) { refresh(); toast({ title: `已${decision}来源`, description: result.note, status: 'success' }) }
    else toast({ title: '裁决失败', description: result.note, status: isWriteFailure(result.note) ? 'error' : 'warning' })
    return result
  }, [role, resolveSource, refresh, toast])

  const postComment = useCallback(async (channel: string, anchor: string, content: string, opId?: string, asRole?: Role): Promise<MutationResult> => {
    const actor = asRole ?? role
    const result = await runMutation<CommentVars>({
      mutateAsync: addComment.mutateAsync,
      kind: 'addComment',
      description: `${actor}在 ${anchor} 提交审阅意见`,
      opId,
      input: { role: actor, author: actor === '法务' ? '黎清' : '章宁', channel, anchor, content, at: now() },
    })
    if (result.ok) { refresh(); toast({ title: '意见已提交', description: result.note, status: 'success' }) }
    else toast({ title: '意见提交失败', description: result.note, status: 'error' })
    return result
  }, [role, addComment, refresh, toast])

  const closeComment = useCallback(async (commentId: string, opId?: string, asRole?: Role): Promise<MutationResult> => {
    const actor = asRole ?? role
    const result = await runMutation<ResolveCommentVars>({
      mutateAsync: resolveComment.mutateAsync,
      kind: 'resolveComment',
      description: `${actor}处理意见 ${commentId}`,
      opId,
      input: { commentId, role: actor, at: now() },
    })
    if (result.ok) { refresh(); toast({ title: '意见已处理', description: result.note, status: 'success' }) }
    else toast({ title: '处理失败', description: result.note, status: isWriteFailure(result.note) ? 'error' : 'warning' })
    return result
  }, [role, resolveComment, refresh, toast])

  /** outbox 续作：按失败操作的 kind 用同一 opId 和原始入参重放（身份沿用原操作） */
  const retryFailed = useCallback(async (op: FailedOp): Promise<MutationResult> => {
    const replayRole = op.input.role as Role
    const replayAt = now()
    const notify = (result: MutationResult, successText: string) => {
      if (result.ok) { refresh(); toast({ title: successText, description: result.note, status: 'success' }) }
      else toast({ title: '重试仍失败', description: result.note, status: 'error' })
      return result
    }
    if (op.kind === 'submitWindow') {
      const result = await runMutation<SubmitVars>({
        mutateAsync: submit.mutateAsync,
        kind: 'submitWindow',
        description: op.description,
        opId: op.opId,
        input: { role: replayRole, baseRevision: op.input.baseRevision as number, windowId: op.input.windowId as string, patch: op.input.patch as SubmitVars['patch'], at: replayAt },
      })
      return notify(result, '重试成功，字段已写入')
    }
    if (op.kind === 'resolveSource') {
      const result = await runMutation<SourceVars>({
        mutateAsync: resolveSource.mutateAsync,
        kind: 'resolveSource',
        description: op.description,
        opId: op.opId,
        input: { sourceId: op.input.sourceId as string, role: replayRole, decision: op.input.decision as SourceVars['decision'], at: replayAt },
      })
      return notify(result, `已${op.input.decision as string}来源`)
    }
    if (op.kind === 'addComment') {
      const result = await runMutation<CommentVars>({
        mutateAsync: addComment.mutateAsync,
        kind: 'addComment',
        description: op.description,
        opId: op.opId,
        input: { role: replayRole, author: op.input.author as string, channel: op.input.channel as string, anchor: op.input.anchor as string, content: op.input.content as string, at: replayAt },
      })
      return notify(result, '意见已提交')
    }
    if (op.kind === 'resolveComment') {
      const result = await runMutation<ResolveCommentVars>({
        mutateAsync: resolveComment.mutateAsync,
        kind: 'resolveComment',
        description: op.description,
        opId: op.opId,
        input: { commentId: op.input.commentId as string, role: replayRole, at: replayAt },
      })
      return notify(result, '意见已处理')
    }
    removeFailed(op.opId)
    return { ok: false, revision: 0, note: '审批操作请重新发起', opId: op.opId }
  }, [submit, resolveSource, addComment, resolveComment, refresh, toast, removeFailed])

  return { role, submitPatch, decideSource, postComment, closeComment, retryFailed }
}
