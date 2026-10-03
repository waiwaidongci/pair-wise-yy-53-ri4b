'use client'

import { Badge, Box, Button, Flex, HStack, Text } from '@chakra-ui/react'
import type { PendingSource, RightsDraft, WindowField } from '@/lib/draft/types'
import { fieldLabel } from '@/lib/draft/engine'

interface Row {
  field: WindowField
  by: string
  revision?: number
  value: string | number | boolean
}

function ValueView({ value }: { value: string | number | boolean }) {
  if (typeof value === 'boolean') return <Badge colorScheme={value ? 'purple' : 'gray'}>{value ? '独占' : '非独占'}</Badge>
  return <Text as="span" fontWeight="700">{String(value)}</Text>
}

function SourceCard({ title, color, fields, badge }: { title: string; color: string; fields: Row[]; badge: string }) {
  return (
    <Box flex={1} bg="white" border="1px solid" borderColor={`${color}.200`} borderRadius="8px" p={3}>
      <Flex justify="space-between" mb={2}>
        <Text fontWeight="800" fontSize="sm" color={`${color}.700`}>{title}</Text>
        <Badge colorScheme={color}>{badge}</Badge>
      </Flex>
      {fields.map((f) => (
        <HStack key={f.field} fontSize="sm" mb={1} align="baseline">
          <Text color="gray.500" minW="64px">{fieldLabel(f.field)}</Text>
          <ValueView value={f.value} />
          <Text fontSize="xs" color="gray.400">{f.by}{f.revision ? ` · r${f.revision}` : ''}</Text>
        </HStack>
      ))}
    </Box>
  )
}

export function PendingSourcesPanel({ draft, onResolve }: { draft: RightsDraft; onResolve: (sourceId: string, decision: '采纳' | '拒绝', opId?: string) => void }) {
  if (!draft.pendingSources.length) return null
  const windowById = new Map(draft.windows.map((w) => [w.id, w]))
  return (
    <Box bg="pink.50" border="1px solid" borderColor="pink.200" borderRadius="8px" p={4} mb={4}>
      <Flex justify="space-between" mb={3} align="center">
        <Box><Text fontWeight="800" color="pink.800">同一窗口两端都改过：并列来源待裁决（窗口已退回审阅，独占标记未覆盖）</Text>
          <Text fontSize="xs" color="gray.600">两条来源并列保留，审阅人逐条采纳或拒绝后重算冲突结论。</Text></Box>
        <Badge colorScheme="pink">{draft.pendingSources.length} 条待定</Badge>
      </Flex>
      {draft.pendingSources.map((source: PendingSource) => {
        const win = windowById.get(source.windowId)
        const incoming: Row[] = (Object.keys(source.patch) as WindowField[]).map((f) => ({ field: f, by: source.by, value: source.patch[f] as string | number | boolean }))
        const saved: Row[] = source.otherSide.map((f) => ({ field: f.field, by: f.by, revision: f.revision, value: f.value }))
        return (
          <Box key={source.id} bg="pink.100" borderRadius="8px" p={3} mb={3}>
            <Flex gap={2} mb={2} align="center" flexWrap="wrap">
              <Badge colorScheme="pink">{source.windowId}</Badge>
              <Text fontWeight="700" fontSize="sm">{win?.work} · {win?.channel}</Text>
              <Text fontSize="xs" color="gray.600">提交方 {source.by} 基于 r{source.baseRevision} · {source.at.slice(0, 16).replace('T', ' ')}</Text>
            </Flex>
            <Text fontSize="xs" color="pink.700" mb={2}>{source.reason}</Text>
            <Flex gap={3} direction={{ base: 'column', md: 'row' }}>
              <SourceCard title={`来源一：${source.by}（未写入）`} color="pink" badge="后保存" fields={incoming} />
              <SourceCard title={`来源二：${source.otherSide[0]?.by ?? '对端'}（已保存）`} color="blue" badge="先保存" fields={saved} />
            </Flex>
            <HStack mt={3}>
              <Button size="sm" colorScheme="blue" onClick={() => onResolve(source.id, '采纳')}>采纳提交方来源</Button>
              <Button size="sm" variant="outline" onClick={() => onResolve(source.id, '拒绝')}>拒绝提交方来源</Button>
              <Text fontSize="xs" color="gray.500">采纳会按原作者 {source.by} 写入；拒绝仅留痕，权威稿保持已保存值。</Text>
            </HStack>
          </Box>
        )
      })}
    </Box>
  )
}
