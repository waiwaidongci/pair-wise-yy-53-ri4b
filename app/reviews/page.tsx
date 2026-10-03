'use client'

import { useState } from 'react'
import { Box, Flex, Grid, Heading, Text, Badge, Button, Textarea, Tabs, TabList, Tab, TabPanels, TabPanel, useToast, Spinner, Select, HStack, Collapse, useDisclosure } from '@chakra-ui/react'
import { trpc } from '@/trpc/client'
import { useDraftActions } from '@/trpc/use-draft-actions'
import { useUiStore } from '@/store/ui'
import { OutboxBanner } from '@/components/OutboxBanner'
import { PendingSourcesPanel } from '@/components/PendingSourcesPanel'
import { GatePanel, RevisionBadge } from '@/components/Revision'

const stateColor: Record<string, string> = { 待处理: 'orange', 已解决: 'green', 已随变更失效: 'gray' }

export default function ReviewsPage() {
  const draftQuery = trpc.draft.useQuery()
  const { decideSource, postComment, closeComment, retryFailed } = useDraftActions()
  const failedOps = useUiStore((state) => state.failedOps)
  const bumpRetry = useUiStore((state) => state.bumpRetry)
  const resetDraft = trpc.resetDraft.useMutation()
  const utils = trpc.useUtils()
  const toast = useToast()
  const [anchorWindow, setAnchorWindow] = useState('')
  const [draftText, setDraftText] = useState('')
  const [openHistory, setOpenHistory] = useState<string | null>(null)
  const disclosure = useDisclosure()

  if (draftQuery.isLoading || !draftQuery.data) {
    return <Flex align="center" justify="center" h="320px" direction="column" gap={3}><Spinner size="xl" color="blue.500" /><Text color="gray.500">正在打开带修订号的完整草稿…</Text></Flex>
  }
  const draft = draftQuery.data

  function exportPackage() {
    const report = {
      revision: draft.revision,
      generatedAt: new Date().toISOString(),
      gate: draft.gate,
      windows: draft.windows.map((w) => ({ id: w.id, channel: w.channel, territory: w.territory, start: w.start, end: w.end, exclusive: w.exclusive, status: w.status, fieldOrigins: w.fields })),
      unresolved: draft.comments.filter((c) => c.state === '待处理').map((c) => ({ id: c.id, anchor: c.anchor, author: c.author, content: c.content })),
      invalidated: draft.comments.filter((c) => c.state === '已随变更失效').map((c) => ({ id: c.id, anchor: c.anchor, history: c.history })),
      versions: draft.versions,
      migration: draft.migratedFromLegacy ? { migratedAt: draft.migratedAt } : undefined,
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `发行权审批包-r${draft.revision}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    toast({ title: `审批包 r${draft.revision} 已导出`, description: '含修订号、意见轨迹与迁移记录', status: 'success' })
  }

  async function submitComment() {
    const win = draft.windows.find((w) => w.id === anchorWindow)
    if (!win) return toast({ title: '请选择锚点窗口', status: 'warning' })
    await postComment(win.channel, `${win.id} · 条款审阅`, draftText)
    setDraftText('')
  }

  return (
    <Box>
      <Flex justify="space-between" mb={4} gap={4} direction={{ base: 'column', md: 'row' }}>
        <Box>
          <Text color="brand.600" fontSize="xs" fontWeight="bold">VERSION & APPROVAL · TRACEABLE</Text>
          <Heading fontSize="2xl" my={1}>版本比较与条款合并</Heading>
          <Text color="gray.600" fontSize="sm">提交只写自己改过的字段；未处理意见、失效意见、并列来源与审批门禁随修订号联动。</Text>
        </Box>
        <HStack>
          <RevisionBadge draft={draft} />
          <Button variant="outline" size="sm" onClick={() => resetDraft.mutate(undefined, { onSuccess: () => { utils.draft.invalidate(); toast({ title: '草稿已重置为迁移后初始状态', status: 'info' }) } })}>重置演示数据</Button>
          <Button colorScheme="blue" onClick={exportPackage}>导出可追溯审批包</Button>
        </HStack>
      </Flex>

      {draft.migratedFromLegacy && (
        <Box bg="blue.50" border="1px solid" borderColor="blue.200" borderRadius="8px" p={3} mb={3}>
          <HStack justify="space-between">
            <Text fontSize="sm" color="blue.800">旧稿已自动迁移到当前结构（{draft.migratedAt?.slice(0, 16).replace('T', ' ')}）：修订号 r1 起，独占标记原样保留，{draft.comments.length} 条历史意见全部可追溯。</Text>
            <Button size="xs" variant="link" onClick={disclosure.onToggle}>{disclosure.isOpen ? '收起' : '查看迁移记录'}</Button>
          </HStack>
          <Collapse in={disclosure.isOpen} animateOpacity>
            {draft.versions.filter((v) => v.kind === '迁移').map((v) => (
              <Box key={v.revision + v.summary} mt={2} fontSize="xs" color="gray.600">{v.changes.map((c) => <Text key={c.detail}>· {c.detail}</Text>)}</Box>
            ))}
          </Collapse>
        </Box>
      )}

      <Box mb={4}><GatePanel draft={draft} /></Box>

      <OutboxBanner onRetry={(opId) => { bumpRetry(opId); void retryFailed(failedOps.find((x) => x.opId === opId)!) }} />
      <PendingSourcesPanel draft={draft} onResolve={(sourceId, decision) => decideSource(sourceId, decision)} />

      <Tabs colorScheme="blue" variant="enclosed">
        <TabList><Tab>条款意见（{draft.comments.filter((c) => c.state === '待处理').length} 待处理）</Tab><Tab>版本记录（r{draft.revision}）</Tab></TabList>
        <TabPanels>
          <TabPanel px={0} pt={4}>
            <Grid templateColumns={{ base: '1fr', lg: '1.3fr .8fr' }} gap={4}>
              <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px">
                {draft.comments.map((c) => (
                  <Box key={c.id} p={4} borderBottom="1px solid" borderColor="gray.100">
                    <Flex justify="space-between">
                      <Box><Text fontWeight="700">{c.role} · {c.author}</Text><Text color="gray.500" fontSize="xs">{c.anchor}{c.conflictKey ? ` · 冲突 ${c.conflictKey.slice(0, 22)}…` : ''}</Text></Box>
                      <Badge colorScheme={stateColor[c.state]}>{c.state}</Badge>
                    </Flex>
                    <Text color="gray.600" mt={2} fontSize="sm">{c.content}</Text>
                    <HStack mt={2}>
                      {c.state === '待处理' && <Button size="sm" colorScheme="blue" variant="outline" onClick={() => closeComment(c.id)}>处理意见</Button>}
                      <Button size="xs" variant="ghost" onClick={() => setOpenHistory(openHistory === c.id ? null : c.id)}>{openHistory === c.id ? '收起轨迹' : `查看轨迹（${c.history.length}）`}</Button>
                    </HStack>
                    <Collapse in={openHistory === c.id} animateOpacity>
                      <Box mt={2} bg="gray.50" borderRadius="6px" p={2}>
                        {c.history.map((h, i) => (
                          <Text key={i} fontSize="xs" color="gray.600">· {h.at.slice(0, 16).replace('T', ' ')} · {h.by} → <Badge colorScheme={stateColor[h.state]}>{h.state}</Badge>{h.note ? `（${h.note}）` : ''}</Text>
                        ))}
                      </Box>
                    </Collapse>
                  </Box>
                ))}
              </Box>
              <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
                <Heading size="md" mb={3}>发表审阅意见</Heading>
                <Text fontSize="sm" mb={1}>锚点窗口</Text>
                <Select mb={3} placeholder="选择窗口" value={anchorWindow} onChange={(e) => setAnchorWindow(e.target.value)}>
                  {draft.windows.map((w) => <option key={w.id} value={w.id}>{w.id} · {w.channel} · {w.territory}</option>)}
                </Select>
                <Textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={6} placeholder="意见会进入待处理并更新审批门禁；若锚定冲突结论，结论失效时意见自动转入历史。" />
                <Button mt={3} colorScheme="blue" w="100%" isDisabled={!draftText.trim()} onClick={submitComment}>提交意见（修订号 +1）</Button>
              </Box>
            </Grid>
          </TabPanel>
          <TabPanel px={0} pt={4}>
            <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={2}>
              {draft.versions.map((v) => (
                <Box key={`${v.revision}-${v.at}-${v.summary}`} p={3} borderBottom="1px solid" borderColor="gray.100">
                  <Flex justify="space-between" mb={1}>
                    <HStack><Badge colorScheme={v.kind === '审批' ? 'green' : v.kind === '退回审阅' ? 'pink' : v.kind === '迁移' ? 'blue' : v.kind === '来源裁决' ? 'purple' : 'gray'}>{v.kind}</Badge><Text fontWeight="700" fontSize="sm">r{v.revision} · {v.author}</Text></HStack>
                    <Text color="gray.500" fontSize="xs">{v.at.slice(0, 16).replace('T', ' ')}</Text>
                  </Flex>
                  <Text fontSize="sm" color="gray.700">{v.summary}</Text>
                  {v.changes.map((c) => <Text key={c.detail} fontSize="xs" color="gray.500" mt={1}>· [{c.op}] {c.detail}{c.windowId ? `（${c.windowId}${c.field ? ' / ' + c.field : ''}）` : ''}</Text>)}
                </Box>
              ))}
            </Box>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  )
}
