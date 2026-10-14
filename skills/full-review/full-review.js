export const meta = {
  name: 'seneschal-full-review',
  description: '観点の違う4体で対象全体を監査し、直し、ゼロから再監査する。新しい指摘が0件でテストが通るまで回す（上限5周）',
  phases: [
    { title: '監査', detail: 'ソース・テスト・結合部と仕様・セキュリティを並列に。毎周ゼロから全体を読む' },
    { title: '試験', detail: 'テストと lint を実際に走らせ、コマンドと件数を残す' },
    { title: '修正', detail: 'ゲートとやらないことに当たる物は直さずに残す' },
  ],
}

// 正本は SKILL.md。ここはループの形だけを持つ（周回の判定をモデルに任せないため）。
const A = args || {}
const TARGET = A.target || '.'
const PARTS = A.parts && A.parts.length ? A.parts : [TARGET]
const TESTS = A.testCommands || []
const SPECS = A.specs || []
const DONOT = A.doNot || []
const MAX = A.maxRounds || 5

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
          summary: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['file', 'severity', 'summary', 'evidence'],
      },
    },
    unread: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings', 'unread'],
}

const TESTRUN = {
  type: 'object',
  properties: {
    runs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          exitCode: { type: 'integer' },
          passed: { type: 'integer' },
          failed: { type: 'integer' },
          skipped: { type: 'integer' },
          tail: { type: 'string' },
        },
        required: ['command', 'exitCode', 'tail'],
      },
    },
  },
  required: ['runs'],
}

const DECIDED = {
  type: 'array',
  items: {
    type: 'object',
    properties: { id: { type: 'string' }, reason: { type: 'string' } },
    required: ['id', 'reason'],
  },
}
const FIX = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'string' } },
    rejected: DECIDED,
    held: DECIDED,
    heldTests: {
      type: 'array',
      items: {
        type: 'object',
        properties: { command: { type: 'string' }, reason: { type: 'string' } },
        required: ['command', 'reason'],
      },
    },
  },
  required: ['fixed', 'rejected', 'held', 'heldTests'],
}

const LENSES = [
  { key: 'source', agent: 'seneschal:lens', whole: false,
    focus: 'ソースコード。命名・構造・エラー処理・死んだコード・重複・コメントと実装の食い違い。' },
  { key: 'tests', agent: 'seneschal:lens', whole: false,
    focus: 'テスト。本当に走っているか（skip、除外設定、収集されていないファイル）、本当に検証しているか（空のアサーション、常に真、モックしすぎ）、実装にあってテストが無い経路。' },
  { key: 'structure', agent: 'seneschal:gabriel', whole: true,
    focus: 'モジュールの結合部と仕様のずれ。書き手と読み手でスキーマ・フィールド名・型が一致しているか、参照先が実在するか、データの受け渡しに断絶が無いか、設定と実体（スクリプトのパス、イベント名）が対応しているか、同じ概念を複数箇所に書いた記述が一致しているか。仕様にあって実装に無い物、実装にあって仕様に無い物、飛ばされた段階。' },
  { key: 'security', agent: 'seneschal:lens', whole: false,
    focus: 'セキュリティ。入力検証、認証と認可、インジェクション、シークレットの露出、依存の既知の脆弱性、ログやエラーからの情報漏洩、安全でないデシリアライズ。' },
]

function auditPrompt(lens, scope, round, settled) {
  return [
    `あなたは full-review の監査役である。観点は1つだけ ── ${lens.focus}`,
    `対象: ${scope}。この範囲を全部読む。前の周の指摘を確かめるだけで終わらせない（第${round}周）。`,
    SPECS.length ? `仕様の所在: ${SPECS.join(', ')}` : '仕様の所在は渡されていない。見つけたら使い、見つけた場所を evidence に書く。',
    settled.length
      ? '次の指摘は前の周で片付いている（偽陽性として却下、または主人へ回した）。理由を覆す新しい証拠が無い限り、もう一度出さない:\n' +
        settled.map(s => `- ${s.file}:${s.line || ''} ${s.summary} ── ${s.reason}`).join('\n')
      : '',
    '指摘ごとに evidence（自分で見たファイルと行、または実行したコマンドとその出力）を必ず付ける。付けられない物は出さない。',
    'severity は3つ。critical は動作・安全・データを壊す物、warning は直すべき物、info は記録だけでよい物。迷ったら出す（取捨は後段がする）。',
    '読めなかった範囲、読み切れなかった範囲は unread に書く。無ければ空の配列。ファイルを書き換えない。',
  ].filter(Boolean).join('\n\n')
}

function testPrompt() {
  return [
    `対象 ${TARGET} で次のコマンドを順に実行し、それぞれの終了コード・件数・出力の末尾を返す。`,
    TESTS.map(c => `- ${c}`).join('\n'),
    '件数が出力から読めなければ省く。コマンドを書き換えない。足さない。ファイルを書き換えない。',
  ].join('\n\n')
}

function fixPrompt(items, failing) {
  return [
    `あなたは full-review の修正役である。対象: ${TARGET}`,
    '次の指摘を1件ずつ見て、直すか、却下するか、残すかを決める。',
    items.map(f => `- [${f.id}] (${f.lens}/${f.severity}) ${f.file}:${f.line || ''} ${f.summary}\n  証拠: ${f.evidence}`).join('\n'),
    failing.length
      ? '失敗しているテストと lint:\n' + failing.map(r => `- ${r.command}（exit ${r.exitCode}）\n${r.tail}`).join('\n')
      : '',
    '却下（rejected）は、証拠を確かめて偽陽性だった物。理由を書く。',
    '残す（held）は、直すと次のどれかに当たる物。直さずに理由を書く ── 外部のコードや依存の導入、削除、リポジトリの外への書込、外部への送信、統治文書（CLAUDE.md、設定、ゲートの定義）の変更' +
      (DONOT.length ? '、' + DONOT.join('、') : '') + '。',
    '失敗しているテストのうち、直すと上のどれかに当たる物や、環境の都合で直せない物は、heldTests にコマンドと理由を書く。',
    'それ以外は直し、fixed に id を入れる。どの id も fixed・rejected・held のどれか1つに入れる。直したらテストを壊していないかを自分で確かめる。commit しない。',
  ].filter(Boolean).join('\n\n')
}

const rounds = []
const settled = []
const heldTests = []
let green = false
let lastInfo = []
let open = []
if (!TESTS.length) log('testCommands が空。テストは走らせない（報告に「測っていない」と書く）')

for (let round = 1; round <= MAX; round++) {
  const jobs = LENSES.flatMap(l => (l.whole ? [TARGET] : PARTS).map(scope => ({ l, scope })))
  const [audits, tests] = await Promise.all([
    parallel(jobs.map(j => () => agent(auditPrompt(j.l, j.scope, round, settled), {
      agentType: j.l.agent, schema: FINDINGS, phase: '監査', label: `${j.l.key} ${j.scope} #${round}`,
    }))),
    TESTS.length
      ? agent(testPrompt(), { agentType: 'seneschal:lens', schema: TESTRUN, phase: '試験', label: `試験 #${round}` })
      : Promise.resolve(null),
  ])

  const missing = jobs.filter((j, i) => !audits[i]).map(j => `${j.l.key} ${j.scope}`)
  if (TESTS.length && !tests) missing.push('試験')
  const found = audits.flatMap((a, i) => (a ? a.findings.map(f => ({ ...f, lens: jobs[i].l.key })) : []))
  const blocking = found.filter(f => f.severity !== 'info').map((f, i) => ({ ...f, id: `R${round}-${i + 1}` }))
  // 主人へ回したテストは失敗として数えない（結果は rounds[].tests に残る）
  const failing = tests ? tests.runs.filter(r => r.exitCode !== 0 && !heldTests.some(h => h.command === r.command)) : []
  lastInfo = found.filter(f => f.severity === 'info')
  open = [...blocking, ...failing.map(r => ({ test: r.command, exitCode: r.exitCode, tail: r.tail }))]
  const entry = {
    round, blocking: blocking.length, info: lastInfo.length, failing: failing.length, missing,
    unread: audits.filter(Boolean).flatMap(a => a.unread), tests: tests ? tests.runs : null,
  }
  rounds.push(entry)
  log(`第${round}周: 指摘 ${blocking.length}（info ${lastInfo.length}）／テスト失敗 ${failing.length}` +
    (missing.length ? `／落ちた役 ${missing.join(', ')}` : ''))

  // Green は「直した」ではなく「再監査で0件」。落ちた役がいる周は、覆っていないので Green にしない。
  if (!blocking.length && !failing.length && !missing.length) { green = true; break }
  if (round === MAX) { log(`上限 ${MAX} 周に届いた。Green ではないまま返す`); break }
  if (!blocking.length && !failing.length) continue

  const fix = await agent(fixPrompt(blocking, failing), { schema: FIX, phase: '修正', label: `修正 #${round}` })
  if (!fix) { log(`第${round}周: 修正役が落ちた。ここで止める`); break }
  // どれにも入らなかった id は捨てずに主人へ回す（捨てると次の周に新しい id で出直し、収束しない）
  const decided = new Set([...fix.fixed, ...fix.rejected.map(r => r.id), ...fix.held.map(h => h.id)])
  const dropped = blocking.filter(b => !decided.has(b.id)).map(b => ({ id: b.id, reason: '修正役が判断を返さなかった' }))
  for (const d of [...fix.rejected.map(r => ({ ...r, kind: '却下' })), ...[...fix.held, ...dropped].map(h => ({ ...h, kind: '主人へ' }))]) {
    const f = blocking.find(b => b.id === d.id)
    if (f) settled.push({ ...f, reason: `${d.kind}: ${d.reason}`, kind: d.kind })
  }
  heldTests.push(...fix.heldTests)
  entry.fix = { fixed: fix.fixed.length, rejected: fix.rejected.length, held: fix.held.length + dropped.length,
    heldTests: fix.heldTests.length }
}

return {
  green,
  rounds,
  open: green ? [] : open,
  held: settled.filter(s => s.kind === '主人へ'),
  heldTests,
  rejected: settled.filter(s => s.kind === '却下'),
  info: lastInfo,
}
