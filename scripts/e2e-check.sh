#!/usr/bin/env bash
set -euo pipefail
BASE="http://localhost:62053/api/trpc"
JQ_PRESENT=$(command -v jq >/dev/null && echo yes || echo no)

post() {
  local proc="$1"; local json="$2"
  curl -s -X POST "$BASE/$proc" -H 'content-type: application/json' --data "$json"
}

get_field() { # dot path from stdin via node
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(eval('o.$1'))})"
}

echo "== 0) 重置演示数据 =="
curl -s -X POST "$BASE/resetDraft" -H 'content-type: application/json' --data '{"json":null}' >/dev/null
curl -s "$BASE/draft" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).result.data;console.log('revision=',d.revision,'migrated=',d.migratedFromLegacy,'comments=',d.comments.length,'gateOpen=',d.gate.open,'exclusiveRW101=',d.windows.find(w=>w.id==='RW-101').exclusive)})"

echo "== 1) 发行基于 r1 改 RW-102 日期（解决院线/流媒体独占重叠） =="
post submitWindow '{"opId":"E2E-OP-00001","role":"海外发行","baseRevision":1,"windowId":"RW-102","patch":{"start":"2026-12-06"},"at":"2026-10-03T11:00:00+08:00"}' | get_field 'result.data.note'

echo "== 2) 注入一次写入失败 =="
curl -s -X POST "$BASE/injectFailure" -H 'content-type: application/json' --data '1' >/dev/null

echo "== 3) 法务基于旧 r1 改 RW-101 优先级（本次写入失败：落库前抛错） =="
R=$(post submitWindow '{"opId":"E2E-OP-FAIL1","role":"法务","baseRevision":2,"windowId":"RW-101","patch":{"priority":7},"at":"2026-10-03T11:05:00+08:00"}')
echo "$R" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log('error=',o.error&&o.error.message)})"

echo "== 3b) 失败后快照未前进（仍是 r2），不出现半份状态 =="
curl -s "$BASE/draft" | get_field 'result.data.revision'

echo "== 4) 按原操作号 E2E-OP-FAIL1 重试（已登记幂等逻辑之外的首次成功落库） =="
post submitWindow '{"opId":"E2E-OP-FAIL1","role":"法务","baseRevision":2,"windowId":"RW-101","patch":{"priority":7},"at":"2026-10-03T11:06:00+08:00"}' | get_field 'result.data.note'

echo "== 5) 再次同号重试必须幂等（不重复落库） =="
post submitWindow '{"opId":"E2E-OP-FAIL1","role":"法务","baseRevision":2,"windowId":"RW-101","patch":{"priority":7},"at":"2026-10-03T11:07:00+08:00"}' | get_field 'result.data.revision'

echo "== 5b) 已成功过的 opId，即使再次注入失败也直接幂等回放 =="
curl -s -X POST "$BASE/injectFailure" -H 'content-type: application/json' --data '1' >/dev/null
post submitWindow '{"opId":"E2E-OP-FAIL1","role":"法务","baseRevision":2,"windowId":"RW-101","patch":{"priority":7},"at":"2026-10-03T11:08:00+08:00"}' | get_field 'result.data.note'

echo "== 5c) 幂等回放不消耗失败配额，用一次新操作消耗掉该注入失败 =="
post addComment '{"opId":"E2E-OP-SACR1","role":"法务","author":"黎清","channel":"星海影院","anchor":"RW-101 · 消耗注入","content":"该操作用于消耗一次注入失败","at":"2026-10-03T11:09:00+08:00"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log('consumed error=',o.error&&o.error.message)})"

echo "== 6) 同一窗口两端都改过：发行再基于 r1 改 RW-101，法务 r3 已先保存 → 双来源退回审阅 =="
post submitWindow '{"opId":"E2E-OP-CONC1","role":"海外发行","baseRevision":1,"windowId":"RW-101","patch":{"exclusive":false,"end":"2027-01-31"},"at":"2026-10-03T11:10:00+08:00"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).result.data;console.log('concurrent=',d.concurrent,'note=',d.note,'pendingSourceId=',d.pendingSourceId)})"
echo "== 7) 校验：独占标记未覆盖、RW-101 退回审阅、门禁关闭 =="
curl -s "$BASE/draft" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).result.data;const w=d.windows.find(x=>x.id==='RW-101');console.log('exclusive=',w.exclusive,'status=',w.status,'pending=',d.pendingSources.length,'incomingExclusive=',d.pendingSources[0].patch.exclusive,'otherSideField=',d.pendingSources[0].otherSide[0].field,'gateBlockers=',d.gate.blockers.map(b=>b.kind).join(','))})"

echo "== 8) 审阅：采纳发行来源（含独占改为 false），重算冲突 =="
PS=$(curl -s "$BASE/draft" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).result.data.pendingSources[0].id))")
post resolveSource "{\"opId\":\"E2E-OP-DEC1\",\"sourceId\":\"$PS\",\"role\":\"法务\",\"decision\":\"采纳\",\"at\":\"2026-10-03T11:15:00+08:00\"}" | get_field 'result.data.note'

echo "== 9) 状态联动：CM-31 应已随排期变更失效；门禁仅剩待处理/冲突项核对 =="
curl -s "$BASE/draft" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).result.data;const cm31=d.comments.find(c=>c.id==='CM-31');console.log('CM-31=',cm31.state,'conflictsHigh=',d.conflicts.filter(c=>c.severity==='高').length,'pending=',d.pendingSources.length,'reviewWindows=',d.windows.filter(w=>w.status==='审阅中').length,'blockers=',d.gate.blockers.map(b=>b.kind+':'+b.count).join(','))})"

echo "== 10) CM-31 随冲突失效；CM-32（物料拆分，独立意见）保持待处理；CM-33 迁移即已解决 =="
curl -s "$BASE/draft" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).result.data;for(const c of d.comments)console.log(c.id,'=',c.state,'bound=',!!c.conflictKey)})"

echo "== 10b) 处理独立意见 CM-32 与临时意见后，门禁更新 =="
post resolveComment '{"opId":"E2E-OP-CM32","commentId":"CM-32","role":"海外发行","at":"2026-10-03T11:20:00+08:00"}' | get_field 'result.data.note'
SACR=$(curl -s "$BASE/draft" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).result.data.comments.find(c=>c.anchor.includes('消耗注入'));console.log(d?d.id:'')})")
if [ -n "$SACR" ]; then post resolveComment "{\"opId\":\"E2E-OP-SACR2\",\"commentId\":\"$SACR\",\"role\":\"法务\",\"at\":\"2026-10-03T11:21:00+08:00\"}" | get_field 'result.data.note'; fi

echo "== 11) 门禁状态（含初始 RW-104/RW-105 是否有冲突） =="
curl -s "$BASE/draft" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).result.data;console.log('gateOpen=',d.gate.open,'blockers=',JSON.stringify(d.gate.blockers.map(b=>({k:b.kind,n:b.count}))))})"

echo "== 12) 审批（若门禁开）或说明阻塞原因 =="
post approve '{"opId":"E2E-OP-APPR1","role":"海外发行","at":"2026-10-03T11:25:00+08:00"}' | get_field 'result.data.note'

echo "== 13) 历史追溯：迁移记录 + 版本记录条数 =="
curl -s "$BASE/draft" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).result.data;console.log('versions=',d.versions.length,'kinds=',d.versions.map(v=>v.kind).join(','));const cm33=d.comments.find(c=>c.id==='CM-33');console.log('CM-33(历史已解决)=',cm33.state,'historyEvents=',cm33.history.length)})"
