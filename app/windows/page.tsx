'use client'

import { useMemo, useState } from 'react'
import { Box, Flex, Grid, Heading, Text, Badge, Button, Input, Select, Checkbox, Table, Thead, Tbody, Tr, Th, Td, useToast, HStack, Code, Divider } from '@chakra-ui/react'
import { useRightsStore, useConflicts, displayWindows, pendingPatchFor, ROLE_ACTOR } from '@/store/rights'
import { FIELD_LABELS } from '@/lib/draft'
import type { LicenseWindow, Territory } from '@/lib/types'

const territories: (Territory | '全部地区')[] = ['全部地区', '中国大陆', '中国香港', '中国台湾', '新加坡', '马来西亚', '北美']

export default function WindowsPage() {
  const toast = useToast()
  const draft = useRightsStore((state) => state.draft)
  const pendingOps = useRightsStore((state) => state.pendingOps)
  const role = useRightsStore((state) => state.role)
  const editWindow = useRightsStore((state) => state.editWindow)
  const batchShift = useRightsStore((state) => state.batchShift)
  const submit = useRightsStore((state) => state.submit)
  const adoptReview = useRightsStore((state) => state.adoptReview)
  const status = useRightsStore((state) => state.status)
  const error = useRightsStore((state) => state.error)
  const retryCount = useRightsStore((state) => state.retryCount)

  const [selectedWindowId, setSelectedWindowId] = useState('RW-102')
  const [selectedTerritory, setSelectedTerritory] = useState<Territory | '全部地区'>('全部地区')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [shiftDays, setShiftDays] = useState(7)

  const windows = draft.windows
  const conflicts = useConflicts()
  const display = useMemo(() => displayWindows(draft, pendingOps), [draft, pendingOps])
  const filtered = useMemo(() => (selectedTerritory === '全部地区' ? display : display.filter((item) => item.territory === selectedTerritory)), [display, selectedTerritory])
  const selected = display.find((item) => item.id === selectedWindowId)
  const pendingPatch = selected ? pendingPatchFor(pendingOps, selected.id) : {}
  const pendingReviewItems = draft.reviewItems.filter((item) => item.status === '待审阅')
  const windowPendingCount = (id: string) => Object.keys(pendingPatchFor(pendingOps, id)).length

  function field<K extends keyof LicenseWindow>(key: K, value: LicenseWindow[K]) {
    if (!selected) return
    editWindow(selected.id, { [key]: value } as Partial<LicenseWindow>)
  }

  return (
    <Box>
      <Flex justify="space-between" mb={5} gap={4} direction={{ base: 'column', md: 'row' }}>
        <Box>
          <Text color="brand.600" fontSize="xs" fontWeight="bold">TIME × TERRITORY · 双端字段级提交</Text>
          <Heading fontSize="3xl" my={1}>授权窗口与地区矩阵</Heading>
          <Text color="gray.600">打开带修订号 v{draft.revision}；提交只写自己改过的字段，同一窗口两边都改过则留两条来源并退回审阅。</Text>
        </Box>
        <HStack>
          <Select maxW="150px" value={selectedTerritory} onChange={(event) => setSelectedTerritory(event.target.value as Territory | '全部地区')}>{territories.map((territory) => <option key={territory}>{territory}</option>)}</Select>
          <Button colorScheme="blue" isDisabled={!pendingOps.length || status === 'saving'} onClick={() => void submit()}>
            {status === 'saving' ? `写入中${retryCount ? `·重试${retryCount}` : ''}…` : `提交 ${pendingOps.length} 项改动`}
          </Button>
        </HStack>
      </Flex>

      {status === 'error' && (
        <Box mb={4} p={3} bg="red.50" borderLeft="3px solid" borderLeftColor="red.500" borderRadius="6px">
          <Flex justify="space-between" align="center">
            <Box><Text fontWeight="700" fontSize="sm">写入失败，未应用任何字段</Text><Text fontSize="sm" color="gray.600">{error}。恢复前不展示半份状态，可按原操作号重试。</Text></Box>
            <Button size="sm" colorScheme="red" variant="outline" onClick={() => void submit()}>按原操作号重试</Button>
          </Flex>
        </Box>
      )}

      {pendingReviewItems.length > 0 && (
        <Box mb={4} bg="orange.50" border="1px solid" borderColor="orange.200" borderRadius="8px" p={4}>
          <Heading size="sm" mb={2}>退回审阅 · 同一窗口两边都改过（{pendingReviewItems.length}）</Heading>
          {pendingReviewItems.map((item) => (
            <Box key={item.id} bg="white" borderRadius="6px" p={3} mb={2} border="1px solid" borderColor="orange.100">
              <Flex justify="space-between" align="center" mb={2}><Text fontWeight="700" fontSize="sm">{item.windowLabel}</Text><Badge colorScheme="orange">待审阅 · 独占标记未覆盖</Badge></Flex>
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={3}>
                {item.sources.map((src, idx) => (
                  <Box key={src.opId} p={2} bg="gray.50" borderRadius="6px" border="1px solid" borderColor="gray.200">
                    <Flex justify="space-between" mb={1}><Text fontSize="xs" fontWeight="700">来源{idx === 0 ? '一' : '二'} · {src.role} {src.actor}</Text><Text fontSize="xs" color="gray.500">{new Date(src.at).toLocaleTimeString()}</Text></Flex>
                    {Object.entries(src.patch).map(([k, v]) => <Text key={k} fontSize="xs" color="gray.700">{FIELD_LABELS[k] ?? k}：{k === 'exclusive' ? (v ? '是' : '否') : String(v)}</Text>)}
                    <Button size="xs" mt={2} colorScheme={idx === 0 ? 'blue' : 'purple'} variant="outline" onClick={() => void adoptReview(item.id, idx as 0 | 1)}>采用来源{idx === 0 ? '一' : '二'}</Button>
                  </Box>
                ))}
              </Grid>
            </Box>
          ))}
        </Box>
      )}

      <Grid templateColumns={{ base: '1fr', xl: 'minmax(0,1.1fr) minmax(360px,.8fr)' }} gap={4}>
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" overflow="hidden">
          <Flex p={4} justify="space-between" align="center"><Heading size="md">授权窗口清单</Heading><HStack><Select size="sm" w="110px" value={shiftDays} onChange={(event) => setShiftDays(Number(event.target.value))}><option value={7}>+7 天</option><option value={14}>+14 天</option><option value={-7}>-7 天</option><option value={-14}>-14 天</option></Select><Button size="sm" onClick={() => { if (!selectedIds.length) return toast({ title: '请选择窗口', status: 'warning' }); batchShift(selectedIds, shiftDays); toast({ title: '已加入批量调窗（未提交）', description: '仅写入改动的起止日期字段。', status: 'info' }) }}>批量调窗</Button></HStack></Flex>
          <Table size="sm"><Thead><Tr><Th w="36px"></Th><Th>作品 / 渠道</Th><Th>地区</Th><Th>开始</Th><Th>结束</Th><Th>独占</Th><Th></Th></Tr></Thead><Tbody>{filtered.map((item) => {
            const pending = windowPendingCount(item.id)
            return (
              <Tr key={item.id} bg={selectedWindowId === item.id ? 'blue.50' : undefined} cursor="pointer" onClick={() => setSelectedWindowId(item.id)}>
                <Td onClick={(event) => event.stopPropagation()}><Checkbox isChecked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></Td>
                <Td><Text fontWeight="600">{item.work}</Text><Text color="gray.500" fontSize="xs">{item.channel} · {item.id}</Text></Td>
                <Td>{item.territory}</Td>
                <Td>{item.start}</Td>
                <Td>{item.end}</Td>
                <Td><Badge colorScheme={item.exclusive ? 'purple' : 'gray'}>{item.exclusive ? '独占' : '普通'}</Badge></Td>
                <Td>{pending > 0 && <Badge colorScheme="purple" size="sm">未提交 {pending}</Badge>}</Td>
              </Tr>
            )
          })}</Tbody></Table>
        </Box>

        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={5}>
          <Heading size="md" mb={1}>窗口条款</Heading>
          <Text color="gray.500" fontSize="sm" mb={4}>{selected?.id ?? '请选择窗口'} · 当前身份 {role} · {ROLE_ACTOR[role]}</Text>
          {selected && (
            <Grid templateColumns="1fr 1fr" gap={4}>
              <Box gridColumn="span 2"><FieldLabel label="渠道" pending={'channel' in pendingPatch}><Input value={selected.channel} onChange={(event) => field('channel', event.target.value)} /></FieldLabel></Box>
              <Box><FieldLabel label="开始日期" pending={'start' in pendingPatch}><Input type="date" value={selected.start} onChange={(event) => field('start', event.target.value)} /></FieldLabel></Box>
              <Box><FieldLabel label="结束日期" pending={'end' in pendingPatch}><Input type="date" value={selected.end} onChange={(event) => field('end', event.target.value)} /></FieldLabel></Box>
              <Box><FieldLabel label="优先顺序" pending={'priority' in pendingPatch}><Input type="number" value={selected.priority} onChange={(event) => field('priority', Number(event.target.value))} /></FieldLabel></Box>
              <Box><FieldLabel label="地区" pending={'territory' in pendingPatch}><Select value={selected.territory} onChange={(event) => field('territory', event.target.value as Territory)}>{territories.filter((item) => item !== '全部地区').map((territory) => <option key={territory}>{territory}</option>)}</Select></FieldLabel></Box>
              <Checkbox isChecked={selected.exclusive} onChange={(event) => field('exclusive', event.target.checked)}>独占窗口{('exclusive' in pendingPatch) && ' · 未提交'}</Checkbox>
              <Checkbox isChecked={selected.sublicense} onChange={(event) => field('sublicense', event.target.checked)}>允许次级授权{('sublicense' in pendingPatch) && ' · 未提交'}</Checkbox>
            </Grid>
          )}
          {selected && conflicts.filter((issue) => issue.windowIds.includes(selected.id)).map((issue) => <Box key={issue.id} mt={4} p={3} bg={issue.severity === '高' ? 'red.50' : 'orange.50'} borderLeft="3px solid" borderLeftColor={issue.severity === '高' ? 'red.500' : 'orange.400'}><Text fontWeight="700" fontSize="sm">{issue.type}</Text><Text fontSize="sm" color="gray.600" mt={1}>{issue.explanation}</Text></Box>)}
          <Button w="100%" mt={5} colorScheme="blue" isDisabled={!pendingOps.length || status === 'saving'} onClick={() => void submit()}>
            {status === 'saving' ? `写入中…${retryCount ? `（第 ${retryCount} 次重试）` : ''}` : `提交 ${pendingOps.length} 项改动（仅改过的字段）`}
          </Button>

          {pendingOps.length > 0 && (
            <Box mt={4}>
              <Divider mb={2} />
              <Text fontSize="xs" color="gray.500" mb={1}>本次提交载荷（字段级 · 操作号稳定可重试）</Text>
              {pendingOps.map((op) => (
                <Code key={op.opId} display="block" whiteSpace="pre-wrap" fontSize="11px" p={2} mb={1} borderRadius="6px">
                  {op.kind === 'window:update' ? `${op.opId}  ${op.role} ${op.actor}  窗口 ${op.windowId}  字段: ${Object.keys(op.patch).join(', ')}`
                    : op.kind === 'window:batchShift' ? `${op.opId}  ${op.role} ${op.actor}  批量调窗 ${op.windowIds.length} 个 · ${op.days} 天`
                    : op.kind === 'comment:resolve' ? `${op.opId}  ${op.role} ${op.actor}  解决意见 ${op.commentId}`
                    : `${op.opId}  ${op.role} ${op.actor}  新增意见`}
                </Code>
              ))}
            </Box>
          )}
        </Box>
      </Grid>
    </Box>
  )
}

function FieldLabel({ label, pending, children }: { label: string; pending: boolean; children: React.ReactNode }) {
  return (
    <Box>
      <Flex justify="space-between" mb={1}><Text fontSize="sm">{label}</Text>{pending && <Badge colorScheme="purple" size="sm">未提交</Badge>}</Flex>
      {children}
    </Box>
  )
}
