'use client'

import { createTRPCReact } from '@trpc/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@/server/router'

export const trpc = createTRPCReact<AppRouter>()

/** 供 zustand store 在 React 之外调用（提交、重试、加载草稿） */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/api/trpc' })],
})
