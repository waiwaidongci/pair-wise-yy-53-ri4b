'use client'

import { Box, Flex, Grid, Heading, Text, Badge, Button, Table, Thead, Tbody, Tr, Th, Td, Progress, Spinner } from '@chakra-ui/react'
import Link from 'next/link'
import { trpc } from '@/trpc/client'
import { GatePanel, RevisionBadge } from '@/components/Revision'
import { PendingSourcesPanel } from '@/components/PendingSourcesPanel'
import { useDraftActions } from '@/trpc/use-draft-actions'

export default function Dashboard() {
  const draftQuery = trpc.draft.useQuery()
  const { decideSource } = useDraftActions()
  if (draftQuery.isLoading || !draftQuery.data) {
    return <Flex align="center" justify="center" h="320px" direction="column" gap={3}><Spinner size="xl" color="blue.500" /><Text color="gray.500">正在打开带修订号的完整草稿…恢复前不展示半份状态</Text></Flex>
  }
  const draft = draftQuery.data
  const windows = draft.windows
  const conflicts = draft.conflicts
  const openComments = draft.comments.filter((item) => item.state === '待处理').length
  const cards = [
    { label: '授权窗口', value: windows.length, note: '字段级合并，独占标记不覆盖' },
    { label: '责任地区', value: new Set(windows.map((item) => item.territory)).size, note: '地区变更触发结论重算' },
    { label: '高危冲突', value: conflicts.filter((item) => item.severity === '高').length, note: '阻止审批通过' },
    { label: '当前修订号', value: `r${draft.revision}`, note: draft.migratedFromLegacy ? '由旧稿迁移获得' : '服务端权威版本' },
  ]
  return (
    <Box>
      <Flex justify="space-between" align="flex-start" gap={4} mb={5} direction={{ base: 'column', md: 'row' }}>
        <Box><Text color="brand.600" fontSize="xs" fontWeight="bold">版权窗口与独占规则 · 双端续作草稿</Text><Heading fontSize={{ base: '2xl', md: '3xl' }} my={1}>授权窗口审阅总览</Heading><Text color="gray.600" fontSize="sm">打开即带修订号，提交只写自己改过的字段；冲突结论、未处理意见与审批门禁联动更新。</Text></Box>
        <Flex gap={2}><RevisionBadge draft={draft} /><Button as={Link} href="/reviews" variant="outline">审阅与版本</Button><Button as={Link} href="/windows" colorScheme="blue">调整窗口</Button></Flex>
      </Flex>
      <Grid templateColumns={{ base: 'repeat(2,1fr)', lg: 'repeat(4,1fr)' }} gap={4} mb={5}>
        {cards.map((card) => <Box key={card.label} bg="white" border="1px solid" borderColor="gray.200" borderLeft="4px solid" borderLeftColor="brand.500" borderRadius="8px" p={4}><Text color="gray.500" fontSize="sm">{card.label}</Text><Heading size="lg" my={1}>{card.value}</Heading><Text color="gray.500" fontSize="xs">{card.note}</Text></Box>)}
      </Grid>

      <Box mb={4}><GatePanel draft={draft} /></Box>
      <PendingSourcesPanel draft={draft} onResolve={(sourceId, decision) => decideSource(sourceId, decision)} />

      <Grid templateColumns={{ base: '1fr', xl: '1.55fr .8fr' }} gap={4} mb={4}>
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" overflow="hidden">
          <Flex p={4} justify="space-between"><Box><Heading size="md">窗口时间轴</Heading><Text color="gray.500" fontSize="sm">按作品与渠道显示授权跨度（含字段来源）</Text></Box><Badge colorScheme="blue">r{draft.revision}</Badge></Flex>
          <Box px={4} pb={4} overflowX="auto">
            {windows.map((item) => {
              const duration = Math.max(8, (new Date(item.end).getTime() - new Date(item.start).getTime()) / 86400000 / 730 * 100)
              const offset = Math.max(0, (new Date(item.start).getTime() - new Date('2026-10-01').getTime()) / 86400000 / 730 * 100)
              return <Box key={item.id} minW="760px" mb={3}><Flex justify="space-between" fontSize="sm" mb={1}><Text fontWeight="600">{item.work} · {item.channel} <Text as="span" color="gray.400" fontSize="11px">{item.id}</Text></Text><Text color="gray.500">{item.start} → {item.end}</Text></Flex><Box position="relative" h="25px" bg="gray.100" borderRadius="4px"><Box position="absolute" left={`${Math.min(offset, 92)}%`} w={`${Math.min(duration, 100 - offset)}%`} h="25px" bg={item.exclusive ? 'blue.500' : 'cyan.400'} borderRadius="4px" display="flex" alignItems="center" px={2} color="white" fontSize="11px" whiteSpace="nowrap" overflow="hidden">{item.rights}{item.exclusive ? ' · 独占' : ''}</Box></Box></Box>
            })}
          </Box>
        </Box>
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
          <Heading size="md" mb={4}>冲突结论 <Badge ml={2} colorScheme={conflicts.some((c) => c.severity === '高') ? 'red' : 'green'}>{conflicts.filter((c) => c.severity === '高').length} 高危</Badge></Heading>
          {conflicts.length === 0 && <Text fontSize="sm" color="gray.500">当前无冲突结论。地区或起止日期变更后将自动重算。</Text>}
          {conflicts.slice(0, 4).map((issue) => <Box key={issue.key} p={3} mb={3} bg={issue.severity === '高' ? 'red.50' : 'orange.50'} borderLeft="3px solid" borderLeftColor={issue.severity === '高' ? 'red.500' : 'orange.400'} borderRadius="6px"><Flex justify="space-between"><Text fontWeight="700" fontSize="sm">{issue.title}</Text><Badge colorScheme={issue.severity === '高' ? 'red' : 'orange'}>{issue.type}</Badge></Flex><Text fontSize="sm" color="gray.600" mt={2}>{issue.explanation}</Text><Text fontSize="10px" color="gray.400" mt={1}>依据修订号 r{issue.basisRevision}</Text></Box>)}
          <Progress value={Math.max(0, 100 - conflicts.length * 18)} colorScheme="blue" borderRadius="4px" mt={2} />
          <Text color="gray.500" fontSize="xs" mt={2}>{openComments} 条意见待处理 · {draft.pendingSources.length} 条并列来源待裁决</Text>
        </Box>
      </Grid>
      <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" overflow="hidden">
        <Flex p={4} justify="space-between"><Heading size="md">窗口条款与字段来源</Heading><Button size="sm" variant="ghost" as={Link} href="/windows">前往编辑</Button></Flex>
        <Table size="sm"><Thead><Tr><Th>作品 / 渠道</Th><Th>权利</Th><Th>地区</Th><Th>窗口</Th><Th>独占</Th><Th>状态</Th><Th>最近来源</Th></Tr></Thead><Tbody>{windows.map((item) => {
          const latest = Object.values(item.fields).filter(Boolean).sort((a, b) => b!.revision - a!.revision)[0]
          return <Tr key={item.id}><Td><Text fontWeight="600">{item.work}</Text><Text color="gray.500" fontSize="xs">{item.channel} · {item.id}</Text></Td><Td>{item.rights}</Td><Td>{item.territory}</Td><Td>{item.start} → {item.end}</Td><Td><Badge colorScheme={item.exclusive ? 'purple' : 'gray'}>{item.exclusive ? '独占' : '普通'}</Badge></Td><Td><Badge colorScheme={item.status === '冲突' ? 'red' : item.status === '审阅中' ? 'pink' : item.status === '已确认' ? 'green' : 'orange'}>{item.status}</Badge></Td><Td><Text fontSize="xs" color="gray.500">{latest?.by ?? '旧稿迁移'} · r{latest?.revision ?? 0}</Text></Td></Tr>
        })}</Tbody></Table>
      </Box>
    </Box>
  )
}
