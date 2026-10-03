'use client'

import { Badge, Box, Flex, Text } from '@chakra-ui/react'
import type { RightsDraft } from '@/lib/draft/types'

export function RevisionBadge({ draft, prefix }: { draft: RightsDraft; prefix?: string }) {
  return (
    <Badge colorScheme="blue" variant="subtle" fontSize="11px" px={2} py={1} borderRadius="6px">
      {prefix ?? '打开修订号'} r{draft.revision}
    </Badge>
  )
}

const blockerColor: Record<string, string> = {
  高危冲突: 'red',
  待处理意见: 'orange',
  退回审阅: 'purple',
  待定来源: 'pink',
}

export function GatePanel({ draft, compact }: { draft: RightsDraft; compact?: boolean }) {
  return (
    <Box bg={draft.gate.open ? 'green.50' : 'red.50'} border="1px solid" borderColor={draft.gate.open ? 'green.200' : 'red.200'} borderRadius="8px" p={compact ? 3 : 4}>
      <Flex justify="space-between" align="center" mb={draft.gate.open ? 0 : 2}>
        <Text fontWeight="800" fontSize="sm" color={draft.gate.open ? 'green.800' : 'red.800'}>
          版本审批门禁：{draft.gate.open ? '开放，可发起审批' : '关闭'}
        </Text>
        <Badge colorScheme={draft.gate.open ? 'green' : 'red'}>r{draft.revision}</Badge>
      </Flex>
      {!draft.gate.open && draft.gate.blockers.map((blocker) => (
        <Box key={blocker.kind} mt={1}>
          <Flex gap={2} align="center">
            <Badge colorScheme={blockerColor[blocker.kind] ?? 'gray'}>{blocker.kind} × {blocker.count}</Badge>
            {!compact && <Text fontSize="xs" color="gray.600" noOfLines={1}>{blocker.detail}</Text>}
          </Flex>
        </Box>
      ))}
      {draft.approvedAt && <Text fontSize="xs" color="green.700" mt={2}>已于 {draft.approvedAt} 审批锁定，只读</Text>}
    </Box>
  )
}
