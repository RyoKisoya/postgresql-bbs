# Issue #2 検証設計書: セキュリティ指摘の実在性と認識相違の整理

| 項目 | 内容 |
|---|---|
| 対象 Issue | [#2 Security Review: セキュリティ改善](https://github.com/RyoKisoya/postgresql-bbs/issues/2) |
| 対象リポジトリ | https://github.com/RyoKisoya/postgresql-bbs |
| 基準コミット | `338889f7c569e0115b26f4d00b6e1a60dcb35721`（`master` / `origin/master`） |
| 検証日 | 2026-11-26 |
| 本書の性質 | **検証結果の設計メモ**（実装は行わない） |
| 想定参照 | PR #3（`docs/change-designs/issue-2-design.md`。レビュー用設計書）: https://github.com/RyoKisoya/postgresql-bbs/pull/3 |

---

## 1. 目的

Issue #2 が自動コードレビューとして提示した 12 件の指摘について、本リポジトリの現行コード
（`bbs.js`, `bbs.html`, `package.json`, `package-lock.json`, `createtable.sql`）を実際に読み、
以下の 3 点を確定する。

1. 指摘の**実在性**（事実か否か）
2. Issue 記載と**行番号の整合**
3. 認識相違・誇張が疑われる項目

なお、実行検証（Node 環境での再現）は環境に `node` が無いため実施できず、コード読解と
正規表現の手動トレースによる検証である。

---

## 2. 検証結果サマリ

| # | Issue 指摘 | 実在性 | 認識相違の有無 |
|---|---|---|---|
| 1 | Cookie の `escape`/`unescape` 使用、`HttpOnly`/`Secure`/`SameSite` 欠如 | 実在 | なし（行番号 L25-35 は概ね正確。実際は L25-37） |
| 2 | XSS: `name`/`value` を無エスケープで書き出す | 実在 | なし（Issue 参照行 L101-117 は実際より下。実際 L76/L140/L144/L133/L136） |
| 3 | `autoLink` の正規表現不正・`h` 前置 | 一部のみ実在 | **認識相違あり**（§4.1 参照） |
| 4 | ファイルタイプ判定 `indexOf` の分岐逆転 | 一部のみ実在 | **認識相違あり**（§4.2 参照） |
| 5 | ページングを生 URL から数値抽出 | 実在 | 過半は実在。`/prev`/`/next` は先に明示分岐されるため誤用は任意パスのみ（§4.3） |
| 6 | リクエスト毎の `pg.Pool` 生成と `drain` リスナ | 実在 | なし（行番号 L64, L234 は正確） |
| 7 | `PORT` 未設定で起動失敗 | 実在ではない（Issue 記載の断定は誤り） | **認識相違あり**（§4.4 参照。実際は環境割当ポートへのフォールバック） |
| 8 | CSRF 対策なし | 実在 | 行番号 L159-219 は実際より上（実際 L186-232） |
| 9 | アップロード検証が真偽値のみ | 実在 | 行番号 L164-169 は実際より上（実際 L199-206） |
| 10 | セキュリティヘッダ欠如 | 実在 | なし（全レスポンス） |
| 11 | デバッグ `console.log` 多数 | 実在 | なし（L49, L52, L58, L66, L96, L112/L113/L116, L187, L196-197, L207-209, L213, L215） |
| 12 | `bbs.html` が `<head>` のみ | 実在 | なし（全 5 行） |

---

## 3. 実在を確認した詳細

### 3.1 Cookie 処理（Issue #1）
- `bbs.js:25-28` `setCookie` は `escape(val)` で値をエスケープし、`HttpOnly` 等の属性なしで
  `Set-Cookie` をセット
- `bbs.js:30-37` `getCookie` は `unescape(msgVal)` で復号。両者は非推奨 API であり
  `encodeURIComponent`/`decodeURIComponent` への置換が安全

### 3.2 XSS（Issue #2）
- `bbs.js:76` `postname`（クッキー由来）を `value="..."` に直接埋め込み
- `bbs.js:140` `name` を無エスケープ
- `bbs.js:144` `value`（`autoLink` 適用後も未エスケープ）
- `bbs.js:133` `<a href="data:'+filetype+';base64,'+filedata+'" download="'+filename+'">'+filename+'</a>` —
  **href 自体は `filetype`（攻撃者制御）由来**であり、`filename` は `download` 属性とアンカーテキストに埋め込まれる
- `bbs.js:136` `<img src="data:'+filetype+';base64,'+filedata+'" title="'+filename+'"/>` —
  **src 自体は `filetype`（攻撃者制御）由来**であり、`filename` は `title` 属性に埋め込まれる
- いずれも `<` を含む入力で HTML 構造を崩せる

### 3.3 Pool 管理（Issue #6）
- `bbs.js:64` ハンドラ内で `new pg.Pool({...})`（リクエストごと）
- `bbs.js:234` リクエストごとに `pool.on('drain', pool.end.bind(pool))` を登録
  → リクエスト終了後も Pool が閉じず、ハンドラが溜まる

### 3.4 その他確定事項
- `bbs.js:6` `const port = process.env.PORT;` はフォールバック無し（L238 `server.listen(port)` に渡る）
- セキュリティヘッダは全レスポンスで皆無（`favicon`/`bbs.css`/`html`/`303` すべて）
- `console.log` はデバッグ出力が残存し、アップロードパス等をログに出力（例: `bbs.js:207-209`）
- `bbs.html` は `<head>` のみ（全 5 行）。本文は `bbs.js` で手組み
- `package-lock.json` は `lockfileVersion: 1`、`pg` は 7.12.1、`semver` は 4.3.2（既知脆弱性 GHSA-c2qf-rxjj-qqgw、7.x < 7.5.2 / 6.x < 6.3.1 / その他 < 5.7.2 の範囲。Dependabot high 1 件（`/security/dependabot/6`））
- `package.json` の `npm` 依存（`^6.13.0`）と `formidable ^1.2.1` は古く、依存更新は Issue/PR #1 に委ねる

---

## 4. 認識相違・注意点

### 4.1 `autoLink`（Issue #3）
Issue は「正規表現が不正で `h` を余分に前置する」が、手動トレースでは通常ケースでは動作する。

- `http://example.com/a?b=c` → `href` は `h` + `tp://example.com/a?b=c` = `http://example.com/a?b=c`
- `https://example.com` → `href` は `h` + `ttps://example.com` = `https://example.com`

問題は主に次の点：
- URL テキスト・href が**HTML エスケープされていない**（XSS は #2 に含まれる）
- `h?` は任意となるため `ttps://...` のような不正入力が混入すると、表示テキストと href が不一致になる edge case
- 正規表現の末端 `[a-zA-Z0-9.\-_@:/~?%&;=+#',()*!]+` は末尾の `?` や `#` を含む文字列で
  誤抽出する可能性

修正方針は「表現の置換」ではなく「URL 抽出と HTML エスケープの分離」を基本とする。

### 4.2 ファイルタイプ判定（Issue #4）
`bbs.js:131` `if(filetype.indexOf(searchtype))` は `searchtype='image'` のとき

- `image/jpeg` → `indexOf` = `0`（falsy）→ else → `<img>` で表示 ✓（偶然正しい）
- `text/plain` → `indexOf` = `-1`（truthy）→ link 分岐 ✓（偶然正しい）

Issue の『画像と非画像の分岐が逆』という記述は**誇張**で、通常タイプでは結果は意図通り。
ただし `application/vnd.image.foo` のような `'image'` を途中に含むタイプでは誤分岐するため、
`indexOf(searchtype) === -1` への明示化（分岐ボディを維持したまま）は必要。`!== -1` 等の変換は分岐を反転させるため行わない。

### 4.3 ページネーション（Issue #5）
`req.url` から `/[^0-9]/g` で数値抽出するのは実在するが、`/prev`・`/next` は先行して明示分岐される
ため、誤動作は `/foo2bar` のような任意パスでのみ発生する。Issue の記載は過剰ではないが、
『経路が曖昧』の影響は限定的。

### 4.4 PORT（Issue #7）
Issue は「`PORT` 未設定で起動失敗」と記載したが、実際は Node が `server.listen(undefined)` に
渡すことで OS 割当ポートへフォールバックする（起動自体は失敗しない）。Codex レビュー時点では
`env -u PORT node bbs.js` がタイムアウトまで生存した旨の報告がある。結果としてデプロイ環境では
`PORT` 注入を前提にした到達不能・誤ポート待ち受けが生じ得る。**Issue 記載の「起動失敗」断定は誤り**で、
フォールバック・必須化の設計対応は依然として要るが、本文中で「起動失敗」と断定しない。

### 4.5 行番号のズレ
Issue 記載（L159-219, L164-169）は実際より上に記載されている。実際は POST 全体 L186-232、
アップロード検証 L199-206。指摘自体は正しく、参照行のみズレている。

---

## 5. 結論

- Issue #2 の指摘は 11/12 件が実在。#7 の「起動失敗」という断定は誤りで、実際は OS 割当ポートへフォールバックする（§4.4）
- 認識相違は #3・#4・#5・#7・#8/#9 の行番号の5 点に限られ、いずれもコード読解ベースの確定事項
- 修正方針（1〜12）は既存設計書 PR #3（`issue-2-design.md`）の通りに進め、今回の検証差分を PR に添付する形で参照する
- 本書は検証のための設計メモであり、実装・テストは行わない
