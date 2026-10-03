'use client'

import { useState } from 'react'
import { Box, Flex, Grid, Heading, Text, Badge, Button, Textarea, Checkbox, Tabs, TabList, Tab, TabPanels, TabPanel, useToast, HStack, Divider } from '@chakra-ui/react'
import { useRightsStore, ROLE_ACTOR } from '@/store/rights'
import { FIELD_LABELS } from '@/lib/draft'

export default function ReviewsPage() {
  const toast = useToast()
  const draft = useRightsStore((state) => state.draft)
  const pendingOps = useRightsStore((state) => state.pendingOps)
  const role = useRightsStore((state) => state.role)
  const resolveComment = useRightsStore((state) => state.resolveComment)
  const addComment = useRightsStore((state) => state.addComment)
  const submit = useRightsStore((state) => state.submit)
  const adoptReview = useRightsStore((state) => state.adoptReview)
  const status = useRightsStore((state) => state.status)
  const retryCount = useRightsStore((state) => state.retryCount)

  const [draftComment, setDraftComment] = useState('流媒体开窗日期以院线独占结束次日为准，并单独拆分港澳台物料。')
  const [accepted, setAccepted] = useState<string[]>(['RW-102 开窗日期由 11-15 调整为 11-20'])

  const comments = draft.comments
  const versions = draft.versions
  const gate = draft.gate
  const pendingReviewItems = draft.reviewItems.filter((item) => item.status === '待审阅')
  const pendingResolveIds = new Set(pendingOps.filter((op) => op.kind === 'comment:resolve').map((op) => (op.kind === 'comment:resolve' ? op.commentId : '')))
  const unresolved = comments.filter((c) => !c.resolved)

  function exportPackage() {
    const report = {
      version: `v${draft.revision}`,
      generatedAt: new Date().toISOString(),
      gate: gate.status,
      blockers: gate.blockers,
      accepted,
      unresolved: unresolved.map((item) => ({ anchor: item.anchor, author: item.author, role: item.role, content: item.content, stale: item.stale ?? false })),
      dualSource: pendingReviewItems.map((item) => ({ window: item.windowLabel, sources: item.sources.map((s) => ({ role: s.role, actor: s.actor, patch: s.patch })) })),
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `发行权审批包-v${draft.revision}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    toast({ title: '审批包已导出', description: `v${draft.revision} · 未处理意见与双来源结论可追溯。`, status: 'success' })
  }

  return (
    <Box>
      <Flex justify="space-between" mb={5} gap={4} direction={{ base: 'column', md: 'row' }}>
        <Box>
          <Text color="brand.600" fontSize="xs" fontWeight="bold">VERSION & APPROVAL · 双端草稿</Text>
          <Heading fontSize="3xl" my={1}>版本比较与条款合并</Heading>
          <Text color="gray.600">打开带修订号 v{draft.revision}；评论锚定窗口，地区/日期变更后未处理意见自动待复核，门禁随冲突更新。</Text>
        </Box>
        <HStack>
          <Button colorScheme="blue" variant="outline" onClick={exportPackage}>导出可追溯审批包</Button>
          <Button colorScheme="blue" isDisabled={!pendingOps.length || status === 'saving'} onClick={() => void submit()}>
            {status === 'saving' ? `写入中…${retryCount ? `（重试 ${retryCount}）` : ''}` : `提交 ${pendingOps.length} 项改动`}
          </Button>
        </HStack>
      </Flex>

      <Box mb={4} p={3} bg={gate.status === '可批准' ? 'green.50' : 'orange.50'} borderLeft="3px solid" borderLeftColor={gate.status === '可批准' ? 'green.500' : 'orange.400'} borderRadius="6px">
        <Flex justify="space-between" align="center">
          <Box><Text fontWeight="700" fontSize="sm">版本审批门禁 · {gate.status}</Text><Text fontSize="sm" color="gray.600">{gate.blockers.length ? gate.blockers.join('；') : '无阻塞项，可进入只读审批。'}</Text></Box>
          <Badge colorScheme={gate.status === '可批准' ? 'green' : 'orange'}>v{draft.revision}</Badge>
        </Flex>
      </Box>

      {pendingReviewItems.length > 0 && (
        <Box mb={4} bg="orange.50" border="1px solid" borderColor="orange.200" borderRadius="8px" p={4}>
          <Heading size="sm" mb={2}>双端来源冲突 · 退回审阅（{pendingReviewItems.length}）</Heading>
          {pendingReviewItems.map((item) => (
            <Box key={item.id} bg="white" borderRadius="6px" p={3} mb={2} border="1px solid" borderColor="orange.100">
              <Flex justify="space-between" align="center" mb={2}><Text fontWeight="700" fontSize="sm">{item.windowLabel}</Text><Badge colorScheme="orange">独占标记未覆盖</Badge></Flex>
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={3}>
                {item.sources.map((src, idx) => (
                  <Box key={src.opId} p={2} bg="gray.50" borderRadius="6px" border="1px solid" borderColor="gray.200">
                    <Text fontSize="xs" fontWeight="700" mb={1}>来源{idx === 0 ? '一' : '二'} · {src.role} {src.actor}</Text>
                    {Object.entries(src.patch).map(([k, v]) => <Text key={k} fontSize="xs" color="gray.700">{FIELD_LABELS[k] ?? k}：{k === 'exclusive' ? (v ? '是' : '否') : String(v)}</Text>)}
                    <Button size="xs" mt={2} colorScheme={idx === 0 ? 'blue' : 'purple'} variant="outline" onClick={() => void adoptReview(item.id, idx as 0 | 1)}>采用来源{idx === 0 ? '一' : '二'}</Button>
                  </Box>
                ))}
              </Grid>
            </Box>
          ))}
        </Box>
      )}

      <Tabs colorScheme="blue" variant="enclosed">
        <TabList><Tab>条款意见</Tab><Tab>版本差异</Tab><Tab>审批时间线</Tab></TabList>
        <TabPanels>
          <TabPanel px={0} pt={4}><Grid templateColumns={{ base: '1fr', lg: '1.3fr .8fr' }} gap={4}>
            <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px">
              {comments.map((comment) => {
                const resolving = pendingResolveIds.has(comment.id)
                return (
                  <Box key={comment.id} p={4} borderBottom="1px solid" borderColor="gray.100">
                    <Flex justify="space-between">
                      <Box>
                        <Text fontWeight="700">{comment.role} · {comment.author}{comment.migrated && <Badge ml={2} size="sm" colorScheme="gray">迁移稿</Badge>}</Text>
                        <Text color="gray.500" fontSize="xs">{comment.anchor}</Text>
                      </Box>
                      <HStack>
                        {comment.stale && !comment.resolved && <Badge colorScheme="yellow">待复核</Badge>}
                        {resolving && <Badge colorScheme="purple">未提交</Badge>}
                        <Badge colorScheme={comment.resolved ? 'green' : 'orange'}>{comment.resolved ? '已解决' : '待处理'}</Badge>
                      </HStack>
                    </Flex>
                    <Text color="gray.600" mt={3}>{comment.content}</Text>
                    {!comment.resolved && !resolving && <Button mt={3} size="sm" colorScheme="blue" variant="outline" onClick={() => resolveComment(comment.id)}>接受并合并条款</Button>}
                    {resolving && <Text mt={3} fontSize="xs" color="purple.600">已加入提交，提交后标记解决。</Text>}
                  </Box>
                )
              })}
            </Box>
            <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
              <Heading size="md" mb={3}>发表评论锚点</Heading>
              <Text fontSize="xs" color="gray.500" mb={2}>当前身份 {role} · {ROLE_ACTOR[role]}（意见随提交写入，仅新增该条）</Text>
              <Badge mb={3}>RW-102 · 独占范围</Badge>
              <Textarea value={draftComment} onChange={(event) => setDraftComment(event.target.value)} rows={7} />
              <Button mt={3} colorScheme="blue" isDisabled={!draftComment.trim()} onClick={() => { addComment(draftComment, 'RW-102 · 独占范围'); toast({ title: '意见已加入提交', description: '提交后仅写入该条意见字段。', status: 'info' }) }}>提交{role}意见</Button>
            </Box>
          </Grid></TabPanel>

          <TabPanel px={0} pt={4}><Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={4}>
            {versions.slice(0, 4).map((version) => (
              <Box key={version.id} bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
                <Flex justify="space-between"><Box><Heading size="md">{version.id}</Heading><Text color="gray.500" fontSize="sm">{version.author} · {version.time ? new Date(version.time).toLocaleString() : ''}</Text></Box><Badge>{version.changes.length} 项</Badge></Flex>
                <Text fontWeight="600" mt={4}>{version.summary}</Text>
                {version.changes.map((change) => <Checkbox key={change} mt={3} isChecked={accepted.includes(change)} onChange={(event) => setAccepted((current) => event.target.checked ? [...current, change] : current.filter((item) => item !== item))}>{change}</Checkbox>)}
              </Box>
            ))}
          </Grid></TabPanel>

          <TabPanel px={0} pt={4}><Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={5}>
            <HStack align="flex-start" mb={5}><Badge colorScheme="green">v{draft.revision}</Badge><Box><Text fontWeight="700">双端草稿已打开</Text><Text color="gray.500" fontSize="sm">修订号 v{draft.revision}，提交按字段合并；同窗口双端改动留两条来源并退回审阅。</Text></Box></HStack>
            <HStack align="flex-start" mb={5}><Badge colorScheme="orange">待复核</Badge><Box><Text fontWeight="700">地区/日期变更触发重算</Text><Text color="gray.500" fontSize="sm">旧冲突结论失效重算，未处理意见标记待复核，门禁随阻塞项更新。</Text></Box></HStack>
            <HStack align="flex-start"><Badge colorScheme={gate.status === '可批准' ? 'green' : 'gray'}>{gate.status}</Badge><Box><Text fontWeight="700">版本审批门禁</Text><Text color="gray.500" fontSize="sm">{gate.blockers.length ? gate.blockers.join('；') : '无阻塞，可进入只读审批。'}</Text></Box></HStack>
          </Box></TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  )
}
