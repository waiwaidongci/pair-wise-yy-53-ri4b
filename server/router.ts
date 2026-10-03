import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import { initialComments, initialWindows } from '@/lib/mock-data'
import { findConflicts } from '@/lib/rules'
import { draftStore } from './draft-store'

const t = initTRPC.create()

const roleSchema = z.enum(['法务', '海外发行'])
const patchSchema = z.object({
  channel: z.string().min(2).optional(),
  rights: z.enum(['院线', '电视', '流媒体', '航空', '非院线']).optional(),
  territory: z.enum(['中国大陆', '中国香港', '中国台湾', '新加坡', '马来西亚', '东南亚区域', '北美']).optional(),
  start: z.string().date().optional(),
  end: z.string().date().optional(),
  exclusive: z.boolean().optional(),
  sublicense: z.boolean().optional(),
  priority: z.number().int().min(1).optional(),
}).refine((patch) => Object.keys(patch).length > 0, '只提交自己改过的字段，且补丁不能为空')

const opIdSchema = z.string().min(6)
const atSchema = z.string().min(8)

const windowInput = z.object({
  channel: z.string().min(2),
  start: z.string().date(),
  end: z.string().date(),
  exclusive: z.boolean(),
})

export const appRouter = t.router({
  catalog: t.procedure.query(() => ({ works: ['W-001', 'W-002'], channels: ['星海影院', '云帆视频', '南华卫视', '海岛航空', '环球新媒体'] })),
  windows: t.procedure.query(() => initialWindows),
  conflicts: t.procedure.query(() => findConflicts(initialWindows)),
  validateWindow: t.procedure.input(windowInput).mutation(({ input }) => {
    if (new Date(input.end) < new Date(input.start)) return { valid: false, message: '窗口结束日期不能早于开始日期。' }
    const collision = initialWindows.find((item) => item.channel === input.channel && input.start <= item.end && item.start <= input.end)
    return collision ? { valid: false, message: `与现有窗口 ${collision.id} 重叠，请调整窗口或明确优先级。` } : { valid: true, message: '窗口结构校验通过。' }
  }),
  comments: t.procedure.query(() => initialComments),

  /** 打开草稿：返回带修订号的完整权威快照，客户端据此渲染 */
  draft: t.procedure.query(() => draftStore.snapshot()),

  /** 字段级提交：只写自己改过的字段；baseRevision 为打开时修订号 */
  submitWindow: t.procedure
    .input(z.object({ opId: opIdSchema, role: roleSchema, baseRevision: z.number().int().min(1), windowId: z.string(), patch: patchSchema, at: atSchema }))
    .mutation(({ input }) => draftStore.submit(input)),

  /** 并列来源裁决（采纳 / 拒绝） */
  resolveSource: t.procedure
    .input(z.object({ opId: opIdSchema, sourceId: z.string(), role: roleSchema, decision: z.enum(['采纳', '拒绝']), at: atSchema }))
    .mutation(({ input }) => draftStore.resolveSource(input)),

  addComment: t.procedure
    .input(z.object({ opId: opIdSchema, role: roleSchema, author: z.string().min(1), channel: z.string().min(1), anchor: z.string().min(2), content: z.string().min(1), at: atSchema }))
    .mutation(({ input }) => draftStore.addComment(input)),

  resolveComment: t.procedure
    .input(z.object({ opId: opIdSchema, commentId: z.string(), role: roleSchema, at: atSchema }))
    .mutation(({ input }) => draftStore.resolveComment(input)),

  approve: t.procedure
    .input(z.object({ opId: opIdSchema, role: roleSchema, at: atSchema }))
    .mutation(({ input }) => draftStore.approve(input)),

  /** 演示写入失败：下一次写操作在落库前抛错，重试同一 opId 幂等 */
  injectFailure: t.procedure.input(z.number().int().min(1).max(5).default(1)).mutation(({ input }) => draftStore.injectFailure(input)),
  resetDraft: t.procedure.mutation(() => draftStore.reset()),
})

export type AppRouter = typeof appRouter
