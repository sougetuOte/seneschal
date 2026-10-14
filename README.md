# Seneschal

Seneschal は、主人（使う人）が不在の間、委任された範囲でプロジェクトを切り盛りする Claude Code のプラグインである。
主人にしか決められない3つの件（ゴールの合意 G0、取り消せない操作 G1、統治文書の書き換え G2）だけを主人に差し出し、それ以外は確認を取りに戻らずに進める。
条文と説明は日本語で書いてある。

## 中身

| 物 | 役目 |
|---|---|
| `core/README.md` | 委任範囲の正本。3ゲートと、その機構の所在 |
| `core/loop.md` | 回し方。面接（G0）、フェーズ分割、委譲、検収、キュー、止め時 |
| `core/handoff.md` | 引き継ぎの様式（`goal.md`・`SESSION_STATE.md`・`tasks.md`） |
| `/seneschal:seneschal` | 入口。面接から始める。`/seneschal:seneschal 条文` と打つと、条文の場所の表を出して終わる |
| `seneschal:columba` | 検収の評価器。`goal.md` の「検証方法」で PASS か FAIL を付ける |
| `/seneschal:magi` | 主人が呼ぶ合議。推進役・批判役・調停役と、別のモデルの批判役 gabriel |
| `/seneschal:full-review` | 主人が呼ぶ全体の再監査。新しい指摘が0件でテストが通るまで回す |
| `seneschal:lens`・`seneschal:gabriel` | magi と full-review の読み手 |

## 使い始める

プロジェクトのフォルダで、次の2つのコマンドを打つ。

```
claude plugin marketplace add sougetuOte/seneschal --scope project
claude plugin install seneschal@seneschal --scope project
```

2つのコマンドは、プロジェクトの `.claude/settings.json` に marketplace と `seneschal@seneschal` の宣言を書く。
このファイルを commit すると、同じリポジトリを開いた人にも宣言が届く。宣言があってもプラグインが入らなければ、2つ目のコマンドを1回打つ。
プラグインは、フォルダを信頼した対話のセッションで読み込まれる。`claude -p` だけでは読み込まれない。

使うときは `/seneschal:seneschal` を打ち、やりたいことを伝える。面接（完了条件・検証方法・やらないこと）から始まり、主人が承認するまで着手しない。
プロジェクトの `SESSION_STATE.md` の「読む順序」には条文3本を入れ、場所は「入口を `/seneschal:seneschal 条文` で起動すると出る表」と書く（`core/handoff.md`）。

## 更新する

```
claude plugin marketplace update seneschal
claude plugin update seneschal@seneschal --scope project
```

更新は、セッションを開き直してから効く。古い版のまま使い続けてもかまわない。
版は `.claude-plugin/plugin.json` にあり、出すたびに tag（`v0.2.0` など）を打つ。

## 知っておくこと

- G1（取り消せない操作）を止める機構は Claude Code の側にあり、このプラグインには無い。
- G2（統治文書の書き換え）を止める機構（`permissions.deny` と `.githooks/pre-commit`）は、Seneschal の開発用のリポジトリにだけある。使う側のプロジェクトでは、何が統治文書かを `goal.md` の「やらないこと」に書く（`core/README.md` の「dogfood 先の G2 には機構が無い」節）。
- 条文とプラグインの中に出てくる `docs/…`、`SESSION_STATE.md` の決定番号（D13 など）、`CLAUDE.md`、`.githooks/` は、開発用のリポジトリ（非公開）の記録を指す。公開用には含めていない。
- クラウドのセッションでは、リポジトリの宣言が読まれないので使えない。

## ライセンス

MIT（`LICENSE`）。
