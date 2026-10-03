'use client'

import { Box, Flex, HStack, Heading, Text, Badge, Button, Select, useToast } from '@chakra-ui/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { trpc } from '@/trpc/client'
import { runMutation, useUiStore } from '@/store/ui'
import { RevisionBadge } from './Revision'

const nav = [
  { href: '/', label: '窗口总览' },
  { href: '/windows', label: '授权窗口' },
  { href: '/reviews', label: '审阅与版本' },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const toast = useToast()
  const role = useUiStore((state) => state.role)
  const setRole = useUiStore((state) => state.setRole)
  const draftQuery = trpc.draft.useQuery(undefined, { refetchInterval: 4000 })
  const utils = trpc.useUtils()
  const injectFailure = trpc.injectFailure.useMutation()
  const approve = trpc.approve.useMutation()
  const draft = draftQuery.data

  async function handleApprove() {
    const result = await runMutation({
      mutateAsync: approve.mutateAsync,
      kind: 'approve',
      description: `发起版本审批（${role}）`,
      input: { role, at: new Date().toISOString() },
    })
    if (result.ok) {
      toast({ title: `r${result.revision} 已审批锁定`, status: 'success' })
      utils.draft.invalidate()
    } else {
      toast({ title: '审批未通过', description: result.note, status: result.note.includes('门禁') ? 'warning' : 'error', duration: 6000 })
    }
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
        <Flex h="auto" minH="64px" bg="white" borderBottom="1px solid" borderColor="gray.200" align="center" px={5} gap={3} position="sticky" top={0} zIndex={20} py={2} flexWrap="wrap">
          <Box flex={1} minW="200px"><Heading fontSize="sm">华映内容集团 · 2026 国际发行草案</Heading><Text fontSize="11px" color="gray.500">法务与海外发行双端协同 · 字段级合并续作</Text></Box>
          <Select size="sm" w="140px" value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            <option value="海外发行">身份：海外发行</option>
            <option value="法务">身份：法务</option>
          </Select>
          {draft && <RevisionBadge draft={draft} />}
          {draft?.approvedAt ? <Badge colorScheme="green">已审批只读</Badge> : <Badge colorScheme={draft?.gate.open ? 'green' : 'red'}>{draft?.gate.open ? '门禁开放' : '门禁关闭'}</Badge>}
          <Button size="sm" variant="outline" onClick={() => { injectFailure.mutate(1, { onSuccess: () => toast({ title: '已注入一次写入失败', description: '下一次提交将失败，可用原操作号重试', status: 'info' }) }) }}>模拟写入失败</Button>
          <Button size="sm" colorScheme="blue" isDisabled={!draft?.gate.open} onClick={handleApprove}>发起审批</Button>
        </Flex>
        <Box p={{ base: 3, lg: 5 }} maxW="1680px" mx="auto">{children}</Box>
      </Box>
    </Flex>
  )
}
