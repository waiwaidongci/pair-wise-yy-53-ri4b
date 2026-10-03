'use client'

import { Alert, AlertIcon, Box, Button, Flex, Text } from '@chakra-ui/react'
import { useUiStore } from '@/store/ui'

/**
 * 写入失败续作条：
 * 草稿快照只来自服务端完整查询，失败操作期间界面不展示半份状态；
 * 每条失败记录保留原操作号，可按原号重试（服务端幂等，不会重复落库）。
 */
export function OutboxBanner({ onRetry }: { onRetry?: (opId: string) => void }) {
  const failedOps = useUiStore((state) => state.failedOps)
  const bumpRetry = useUiStore((state) => state.bumpRetry)
  const removeFailed = useUiStore((state) => state.removeFailed)
  if (!failedOps.length) return null
  return (
    <Alert status="error" borderRadius="8px" mb={3} flexDirection="column" alignItems="stretch">
      {failedOps.map((op) => (
        <Flex key={op.opId} align={{ base: 'flex-start', md: 'center' }} gap={3} py={1} direction={{ base: 'column', md: 'row' }}>
          <Flex flex={1} gap={2} align="center">
            <AlertIcon />
            <Box>
              <Text fontWeight="700" fontSize="sm">写入失败，草稿未变更（不展示半份状态）：{op.description}</Text>
              <Text fontSize="xs" color="red.700">操作号 {op.opId} · 已重试 {op.retries} 次 · 恢复后按原操作号续作</Text>
            </Box>
          </Flex>
          {onRetry && <Button size="sm" colorScheme="red" onClick={() => { bumpRetry(op.opId); onRetry(op.opId) }}>按原操作号重试</Button>}
          <Button size="sm" variant="ghost" onClick={() => removeFailed(op.opId)}>放弃该操作</Button>
        </Flex>
      ))}
    </Alert>
  )
}
