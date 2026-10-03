import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import { findConflicts } from '@/lib/rules'
import { adoptReviewItem, getDraft, resetDraft, setForceFail, submitOps } from './draft-store'

const t = initTRPC.create()

const roleEnum = z.enum(['法务', '发行'])
const rightsEnum = z.enum(['院线', '电视', '流媒体', '航空', '非院线'])
const territoryEnum = z.enum(['中国大陆', '中国香港', '中国台湾', '新加坡', '马来西亚', '东南亚区域', '北美'])

const windowPatch = z.object({
  channel: z.string().min(2).optional(),
  rights: rightsEnum.optional(),
  territory: territoryEnum.optional(),
  start: z.string().date().optional(),
  end: z.string().date().optional(),
  exclusive: z.boolean().optional(),
  sublicense: z.boolean().optional(),
  priority: z.number().optional(),
})

const commentSchema = z.object({
  id: z.string(),
  channel: z.string(),
  anchor: z.string(),
  author: z.string(),
  role: z.string(),
  content: z.string(),
  resolved: z.boolean(),
  stale: z.boolean().optional(),
  migrated: z.boolean().optional(),
})

const opSchema = z.discriminatedUnion('kind', [
  z.object({ opId: z.string(), kind: z.literal('window:update'), windowId: z.string(), patch: windowPatch, actor: z.string(), role: roleEnum, at: z.string() }),
  z.object({ opId: z.string(), kind: z.literal('window:batchShift'), windowIds: z.array(z.string()), days: z.number(), actor: z.string(), role: roleEnum, at: z.string() }),
  z.object({ opId: z.string(), kind: z.literal('comment:resolve'), commentId: z.string(), actor: z.string(), role: roleEnum, at: z.string() }),
  z.object({ opId: z.string(), kind: z.literal('comment:add'), comment: commentSchema, actor: z.string(), role: roleEnum, at: z.string() }),
])

export const appRouter = t.router({
  catalog: t.procedure.query(() => ({ works: ['W-001', 'W-002'], channels: ['星海影院', '云帆视频', '南华卫视', '海岛航空', '环球新媒体'] })),

  draft: t.router({
    get: t.procedure.query(() => getDraft()),
    submit: t.procedure.input(z.object({ baseRevision: z.number(), ops: z.array(opSchema) })).mutation(({ input }) => submitOps(input)),
    adoptReview: t.procedure.input(z.object({ reviewItemId: z.string(), sourceIndex: z.union([z.literal(0), z.literal(1)]) })).mutation(({ input }) => adoptReviewItem(input)),
    setForceFail: t.procedure.input(z.object({ value: z.boolean() })).mutation(({ input }) => ({ force: setForceFail(input.value) })),
    reset: t.procedure.mutation(() => resetDraft()),
  }),

  // 兼容旧查询：直接读权威草稿
  windows: t.procedure.query(() => getDraft().windows),
  conflicts: t.procedure.query(() => findConflicts(getDraft().windows)),
  comments: t.procedure.query(() => getDraft().comments),
  validateWindow: t.procedure.input(windowPatch).mutation(({ input }) => {
    if (input.start && input.end && new Date(input.end) < new Date(input.start)) return { valid: false, message: '窗口结束日期不能早于开始日期。' }
    return { valid: true, message: '窗口结构校验通过。' }
  }),
})

export type AppRouter = typeof appRouter
