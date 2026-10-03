'use client'

import { useState } from 'react'
import { Box, Flex, HStack, Heading, Text, Badge, Button, useToast, Tooltip } from '@chakra-ui/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRightsStore, ROLE_ACTOR } from '@/store/rights'
import { trpcClient } from '@/trpc/client'
import type { Role } from '@/lib/types'

const nav = [
  { href: '/', label: '窗口总览' },
  { href: '/windows', label: '授权窗口' },
  { href: '/reviews', label: '审阅与版本' },
]

const roles: Role[] = ['法务', '发行']

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const toast = useToast()
  const [forceFail, setForceFail] = useState(false)
  const revision = useRightsStore((state) => state.draft.revision)
  const gate = useRightsStore((state) => state.draft.gate)
  const pendingOps = useRightsStore((state) => state.pendingOps)
  const role = useRightsStore((state) => state.role)
  const setRole = useRightsStore((state) => state.setRole)
  const status = useRightsStore((state) => state.status)
  const error = useRightsStore((state) => state.error)
  const retryCount = useRightsStore((state) => state.retryCount)
  const submit = useRightsStore((state) => state.submit)
  const retry = useRightsStore((state) => state.retry)
  const loadLegacyDraft = useRightsStore((state) => state.loadLegacyDraft)
  const resetAll = useRightsStore((state) => state.resetAll)

  const pending = pendingOps.length
  const gateColor = gate.status === '可批准' ? 'green' : 'orange'

  async function toggleForceFail() {
    const next = !forceFail
    setForceFail(next)
    await trpcClient.draft.setForceFail.mutate({ value: next })
    toast({ title: next ? '已置位：下一次写入将失败' : '已取消失败模拟', description: next ? '失败后会按原操作号自动重试，不展示半份状态。' : '', status: next ? 'warning' : 'info', duration: 2500 })
  }

  return (
    <Flex minH="100vh">
      <Box as="aside" w={{ base: '72px', lg: '224px' }} bg="#0f172a" color="white" position="sticky" top={0} h="100vh" px={{ base: 2, lg: 3 }} py={4}>
        <HStack px={2} pb={5} borderBottom="1px solid" borderColor="#263247">
          <Flex w="38px" h="38px" minW="38px" bg="brand.500" borderRadius="8px" align="center" justify="center" fontWeight="900">权</Flex>
          <Box display={{ base: 'none', lg: 'block' }}><Text fontWeight="800">发行权窗口台</Text><Text fontSize="9px" color="#7f8c9f" letterSpacing="1px">RIGHTS CONTROL</Text></Box>
        </HStack>
        <Flex direction="column" gap={1} mt={4}>{nav.map((item) => <Button key={item.href} as={Link} href={item.href} justifyContent="flex-start" variant="ghost" colorScheme="whiteAlpha" bg={pathname === item.href ? 'whiteAlpha.200' : 'transparent'} color={pathname === item.href ? 'white' : '#aebbd0'} px={3}>{item.label}</Button>)}</Flex>
      </Box>
      <Box minW={0} flex={1}>
        <Flex h="64px" bg="white" borderBottom="1px solid" borderColor="gray.200" align="center" px={5} gap={3} position="sticky" top={0} zIndex={20} wrap="wrap" py={2}>
          <Box flex={1} minW="220px">
            <Heading fontSize="sm">华映内容集团 · 2026 国际发行草案</Heading>
            <Text fontSize="11px" color="gray.500" display={{ base: 'none', md: 'block' }}>双端联合审阅 · 打开带修订号 · 提交只写改过的字段</Text>
          </Box>

          <HStack gap={1} bg="gray.100" borderRadius="8px" p={0.5}>
            {roles.map((r) => (
              <Button key={r} size="sm" variant={role === r ? 'solid' : 'ghost'} colorScheme={role === r ? 'blue' : 'gray'} onClick={() => setRole(r)}>
                {r} · {ROLE_ACTOR[r]}
              </Button>
            ))}
          </HStack>

          <Tooltip label="当前草稿修订号，提交时作为基线">
            <Badge colorScheme="blue" variant="subtle">修订号 v{revision}</Badge>
          </Tooltip>
          <Tooltip label={gate.blockers.length ? gate.blockers.join('；') : '门禁通过，可进入只读审批'}>
            <Badge colorScheme={gateColor} variant="subtle">门禁 · {gate.status}</Badge>
          </Tooltip>

          {status === 'saving' && <Badge colorScheme="yellow">写入中{retryCount ? ` · 第 ${retryCount} 次重试` : ''}…</Badge>}
          {status === 'error' && (
            <HStack gap={1}>
              <Badge colorScheme="red">写入失败</Badge>
              <Button size="sm" colorScheme="red" variant="outline" onClick={() => void retry()}>按原操作号重试</Button>
            </HStack>
          )}
          {status === 'idle' && pending > 0 && <Badge colorScheme="purple">{pending} 项未提交</Badge>}

          <Button size="sm" colorScheme="blue" isDisabled={!pending || status === 'saving'} onClick={() => void submit()}>
            {pending ? `提交 ${pending} 项改动` : '已提交'}
          </Button>

          <Tooltip label="演示：让下一次写入失败，验证按原操作号重试且不展示半份状态">
            <Button size="xs" variant="ghost" colorScheme={forceFail ? 'red' : 'gray'} onClick={() => void toggleForceFail()}>模拟失败</Button>
          </Tooltip>
          <Tooltip label="演示：载入缺修订号的旧稿并迁移到当前结构">
            <Button size="xs" variant="ghost" colorScheme="gray" onClick={() => { loadLegacyDraft(); toast({ title: '已迁移旧稿', description: '旧稿无修订号，已迁移到当前结构，历史意见保留可追溯。', status: 'success' }) }}>迁移旧稿</Button>
          </Tooltip>
          <Tooltip label="重置为初始种子草稿">
            <Button size="xs" variant="ghost" colorScheme="gray" onClick={() => void resetAll()}>重置</Button>
          </Tooltip>
        </Flex>
        <Box p={{ base: 3, lg: 5 }} maxW="1680px" mx="auto">{children}</Box>
      </Box>
    </Flex>
  )
}
