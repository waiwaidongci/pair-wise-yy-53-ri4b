'use client'

import { useEffect } from 'react'
import { useRightsStore } from '@/store/rights'

/** 打开草稿时携带修订号：挂载后从权威端加载当前草稿 */
export function DraftLoader({ children }: { children: React.ReactNode }) {
  const loadDraft = useRightsStore((state) => state.loadDraft)
  useEffect(() => {
    void loadDraft()
  }, [loadDraft])
  return <>{children}</>
}
