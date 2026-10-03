'use client'

import { useEffect, useMemo, useState } from 'react'
import { Box, Flex, Grid, Heading, Text, Badge, Button, Input, Select, Checkbox, Table, Thead, Tbody, Tr, Th, Td, Spinner, useToast, HStack, Alert } from '@chakra-ui/react'
import { trpc } from '@/trpc/client'
import { useDraftActions } from '@/trpc/use-draft-actions'
import { useUiStore } from '@/store/ui'
import type { DraftWindow, WindowField } from '@/lib/draft/types'
import type { Territory } from '@/lib/types'
import { conflictsForWindow } from '@/lib/draft/conflicts'
import { OutboxBanner } from '@/components/OutboxBanner'
import { PendingSourcesPanel } from '@/components/PendingSourcesPanel'
import { RevisionBadge } from '@/components/Revision'

const territories: Territory[] = ['中国大陆', '中国香港', '中国台湾', '新加坡', '马来西亚', '东南亚区域', '北美']
const rightsOptions = ['院线', '电视', '流媒体', '航空', '非院线'] as const

type FormState = Record<WindowField, string | number | boolean>

function readForm(w: DraftWindow): FormState {
  return { channel: w.channel, rights: w.rights, territory: w.territory, start: w.start, end: w.end, exclusive: w.exclusive, sublicense: w.sublicense, priority: w.priority }
}

export default function WindowsPage() {
  const draftQuery = trpc.draft.useQuery()
  const { submitPatch, decideSource } = useDraftActions()
  const failedOps = useUiStore((state) => state.failedOps)
  const bumpRetry = useUiStore((state) => state.bumpRetry)
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<string>('')
  const [form, setForm] = useState<FormState | null>(null)
  /** 打开编辑时看到的修订号；提交以它为 baseRevision，不随轮询漂移 */
  const [baseRevision, setBaseRevision] = useState<number>(0)
  const [filterTerritory, setFilterTerritory] = useState<string>('全部地区')

  const draft = draftQuery.data
  const windows = draft?.windows ?? []

  // 首次加载默认选中第一条窗口
  useEffect(() => {
    if (!selectedId && windows.length) setSelectedId(windows[0]!.id)
  }, [selectedId, windows])

  const selected = draft?.windows.find((w) => w.id === selectedId)

  // 服务端快照变化（他人已保存/重试恢复）时，仅在表单未脏时同步，避免把对端内容盖进本地输入
  useEffect(() => {
    if (selected && (!form || JSON.stringify(readForm(selected)) === JSON.stringify(form))) {
      setForm(readForm(selected))
      setBaseRevision(draft!.revision)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, draft?.revision])

  const dirtyFields = useMemo(() => {
    if (!selected || !form) return new Set<WindowField>()
    return new Set((Object.keys(form) as WindowField[]).filter((f) => form[f] !== readForm(selected)[f]))
  }, [selected, form])

  if (draftQuery.isLoading || !draft || !form) {
    return <Flex align="center" justify="center" h="320px" direction="column" gap={3}>
      <Spinner size="xl" color="blue.500" />
      <Text color="gray.500">正在打开带修订号的完整草稿…恢复前不展示半份状态</Text>
    </Flex>
  }

  function edit<K extends WindowField>(field: K, value: FormState[K]) {
    setForm((current) => current ? { ...current, [field]: value } : current)
  }

  async function save() {
    if (!selected || !form) return
    const patch: Partial<FormState> = {}
    for (const f of dirtyFields) (patch as Record<string, unknown>)[f] = form[f]
    if (!Object.keys(patch).length) return toast({ title: '没有改动的字段', status: 'info' })
    await submitPatch(selected.id, baseRevision, patch)
  }

  const filtered = filterTerritory === '全部地区' ? windows : windows.filter((w) => w.territory === filterTerritory)
  const selectedConflicts = conflictsForWindow(draft.conflicts, selectedId)
  const fieldOrigin = (f: WindowField) => selected?.fields[f]

  return (
    <Box>
      <Flex justify="space-between" mb={4} gap={4} direction={{ base: 'column', md: 'row' }}>
        <Box>
          <Text color="brand.600" fontSize="xs" fontWeight="bold">TIME × TERRITORY · FIELD-LEVEL MERGE</Text>
          <Heading fontSize="2xl" my={1}>授权窗口与地区矩阵</Heading>
          <Text color="gray.600" fontSize="sm">打开即带修订号；提交只写自己改过的字段。地区或起止日期一变，旧冲突结论失效重算。</Text>
        </Box>
        <HStack><RevisionBadge draft={draft} /><Select maxW="150px" size="sm" value={filterTerritory} onChange={(e) => setFilterTerritory(e.target.value)}><option>全部地区</option>{territories.map((t) => <option key={t}>{t}</option>)}</Select></HStack>
      </Flex>

      <OutboxBanner onRetry={async (opId) => {
        const op = useUiStore.getState().failedOps.find((x) => x.opId === opId)
        if (!op || op.kind !== 'submitWindow' && op.kind !== 'resolveSource') return
        bumpRetry(opId)
        if (op.kind === 'submitWindow') await submitPatch(op.input.windowId as string, op.input.baseRevision as number, op.input.patch as Parameters<typeof submitPatch>[2], opId)
        else await decideSource(op.input.sourceId as string, op.input.decision as '采纳' | '拒绝', opId)
      }} />

      <PendingSourcesPanel draft={draft} onResolve={(sourceId, decision) => decideSource(sourceId, decision)} />

      <Grid templateColumns={{ base: '1fr', xl: 'minmax(0,1.1fr) minmax(380px,.8fr)' }} gap={4}>
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" overflow="hidden">
          <Flex p={4} justify="space-between" align="center"><Heading size="md">授权窗口清单</Heading><Badge colorScheme="blue">共 {windows.length} 条 · 权威稿 r{draft.revision}</Badge></Flex>
          <Table size="sm">
            <Thead><Tr><Th>作品 / 渠道</Th><Th>地区</Th><Th>开始</Th><Th>结束</Th><Th>独占</Th><Th>状态</Th></Tr></Thead>
            <Tbody>{filtered.map((item) => (
              <Tr key={item.id} bg={selectedId === item.id ? 'blue.50' : undefined} cursor="pointer" onClick={() => setSelectedId(item.id)}>
                <Td><Text fontWeight="600">{item.work}</Text><Text color="gray.500" fontSize="xs">{item.channel} · {item.id}</Text></Td>
                <Td>{item.territory}</Td><Td>{item.start}</Td><Td>{item.end}</Td>
                <Td><Badge colorScheme={item.exclusive ? 'purple' : 'gray'}>{item.exclusive ? '独占' : '普通'}</Badge></Td>
                <Td><Badge colorScheme={item.status === '冲突' ? 'red' : item.status === '审阅中' ? 'pink' : item.status === '已确认' ? 'green' : 'orange'}>{item.status}</Badge></Td>
              </Tr>
            ))}</Tbody>
          </Table>
        </Box>

        {selected && (
          <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={5}>
            <Flex justify="space-between" mb={1}><Heading size="md">窗口条款</Heading><RevisionBadge draft={draft} prefix="基于" /></Flex>
            <Text color="gray.500" fontSize="sm" mb={3}>{selected.id} · {selected.work}</Text>
            {baseRevision < draft.revision && <Alert status="info" fontSize="xs" mb={3} borderRadius="6px">打开后权威稿已前进到 r{draft.revision}，你仍基于 r{baseRevision}：若对端改过同一窗口，提交将并列保留并退回审阅。</Alert>}
            <Grid templateColumns="1fr 1fr" gap={4}>
              <Box gridColumn="span 2"><Text fontSize="sm" mb={1}>渠道 {dirtyFields.has('channel') && <Badge colorScheme="blue" ml={1}>已改</Badge>}</Text><Input value={String(form.channel)} onChange={(e) => edit('channel', e.target.value)} />{fieldOrigin('channel') && <OriginTag f="channel" />}</Box>
              <Box><Text fontSize="sm" mb={1}>权利类型</Text><Select value={String(form.rights)} onChange={(e) => edit('rights', e.target.value as FormState['rights'])}>{rightsOptions.map((r) => <option key={r}>{r}</option>)}</Select></Box>
              <Box><Text fontSize="sm" mb={1}>优先顺序</Text><Input type="number" value={Number(form.priority)} onChange={(e) => edit('priority', Number(e.target.value))} /></Box>
              <Box><Text fontSize="sm" mb={1}>开始日期 {dirtyFields.has('start') && <Badge colorScheme="blue" ml={1}>已改</Badge>}</Text><Input type="date" value={String(form.start)} onChange={(e) => edit('start', e.target.value)} /></Box>
              <Box><Text fontSize="sm" mb={1}>结束日期 {dirtyFields.has('end') && <Badge colorScheme="blue" ml={1}>已改</Badge>}</Text><Input type="date" value={String(form.end)} onChange={(e) => edit('end', e.target.value)} /></Box>
              <Box><Text fontSize="sm" mb={1}>地区 {dirtyFields.has('territory') && <Badge colorScheme="red" ml={1}>变更将重算冲突</Badge>}</Text><Select value={String(form.territory)} onChange={(e) => edit('territory', e.target.value as Territory)}>{territories.map((t) => <option key={t}>{t}</option>)}</Select></Box>
              <Box pt={6}><Checkbox isChecked={Boolean(form.exclusive)} onChange={(e) => edit('exclusive', e.target.checked)}>独占窗口</Checkbox></Box>
              <Box pt={6}><Checkbox isChecked={Boolean(form.sublicense)} onChange={(e) => edit('sublicense', e.target.checked)}>允许次级授权</Checkbox></Box>
            </Grid>

            {selectedConflicts.map((issue) => (
              <Box key={issue.key} mt={3} p={3} bg={issue.severity === '高' ? 'red.50' : 'orange.50'} borderLeft="3px solid" borderLeftColor={issue.severity === '高' ? 'red.500' : 'orange.400'}>
                <Flex justify="space-between"><Text fontWeight="700" fontSize="sm">{issue.type} · {issue.title}</Text><Badge colorScheme={issue.severity === '高' ? 'red' : 'orange'}>{issue.severity}</Badge></Flex>
                <Text fontSize="sm" color="gray.600" mt={1}>{issue.explanation}</Text>
                <Text fontSize="10px" color="gray.400" mt={1}>结论依据 r{issue.basisRevision}</Text>
              </Box>
            ))}

            {failedOps.some((op) => op.kind === 'submitWindow' && op.input.windowId === selected.id) && (
              <Alert status="warning" fontSize="xs" mt={3} borderRadius="6px">该窗口有未恢复的写入操作（见顶部续作条），当前显示的是最后已确认快照。</Alert>
            )}

            <HStack mt={5}>
              <Button colorScheme="blue" onClick={save} isDisabled={dirtyFields.size === 0}>提交 {dirtyFields.size} 个改动字段</Button>
              <Button variant="ghost" onClick={() => { setForm(readForm(selected)); setBaseRevision(draft.revision) }}>丢弃本地改动</Button>
            </HStack>
          </Box>
        )}
      </Grid>
    </Box>
  )

  function OriginTag({ f }: { f: WindowField }) {
    const p = selected!.fields[f]
    return <Text fontSize="10px" color="gray.400" mt={1}>来源：{p?.by ?? '旧稿迁移'} · r{p?.revision ?? 0}{p?.note ? ` · ${p.note}` : ''}</Text>
  }
}
