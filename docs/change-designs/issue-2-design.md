# 設計書: Issue #2「Security Review: セキュリティ改善」対応

| 項目 | 内容 |
|---|---|
| 対象 Issue | [#2 Security Review: セキュリティ改善](https://github.com/RyoKisoya/postgresql-bbs/issues/2) |
| 対象リポジトリ | https://github.com/RyoKisoya/postgresql-bbs |
| 基準コミット | `338889f7c569e0115b26f4d00b6e1a60dcb35721`（`master` / `origin/master`、唯一のコミット） |
| 文書の性質 | 設計レビュー用（**実装・テストは本PRでは行わない**） |
| 変更ファイル | 本設計書 `docs/change-designs/issue-2-design.md` のみ |

---

## 1. 背景と目的

`postgresql-bbs` は Node.js + PostgreSQL + 素の HTML/CSS で構成された最小構成の BBS である。
フレームワークを使わず `http.createServer()` のハンドラ内で HTML を文字列として直接組み立てて
レスポンスしているため、出力エンコーディングや入力検証が各所に欠落している。

Issue #2 は自動コードレビューによって作成されたセキュリティレビュー Issue であり、12 件の指摘と
高レベルの修正案が記載されている。本設計書は、

1. Issue #2 の 12 指摘を現行コード（`338889f`）の実際の行番号で再特定し、
2. 各指摘の是否・重大度・根本原因を整理し、
3. 実装 PR が従うべき設計方針・変更範囲・テスト方針を確定する

ことを目的とする。**本 PR は設計レビューのみが目的で、Issue #2 の完了（`Closes`）を意図しない。**

### 対象外とするもの（本設計書での非対応）

- Issue #2 に記載のない新規機能（認証・会員制・検索・多言語化等）の追加
- Issue #2 の指摘範囲を超えるリファクタリング（モジュール分割、ビルドツール導入等）
- 依存ライブラリのメジャー更新（#11 のdependabot PR #1 との重複を避ける。→ §11 確認事項）

---

## 2. Issue の要求事項

Issue 本文（2026-11-17 作成、コメントなし、state=open）の要求事項は以下。

### 2.1 Major Issues（12 件）

| # | 要求（Issue 原文の要旨） | Issue が参照する行 |
|---|---|---|
| 1 | `escape`/`unescape`（非推奨 API）の使用、`HttpOnly`/`Secure`/`SameSite` 無しのクッキー設定 | `bbs.js` L25-35 |
| 2 | XSS — `name` / `value` を HTML エスケープなしでレスポンスへ書き出し | `bbs.js` L101-117 |
| 3 | `autoLink` の正規表現が不正（`h?ttps?`）で、置換時に `h` を余分に前置する | `bbs.js` L39-48 |
| 4 | ファイルタイプ判定 `if (filetype.indexOf(searchtype))` が一致時（0）に false となり分岐が逆 | `bbs.js` L131 |
| 5 | ページングを URL 生の数字抽出で行っており経路が曖昧 | `bbs.js` L104-105 |
| 6 | リクエスト毎に `new pg.Pool`、加えてリクエスト毎の `drain` リスナでリソース枯渇 | `bbs.js` L64, L234 |
| 7 | `const port = process.env.PORT;` に既定値がなく、未設定だとクラッシュ | `bbs.js` L6 |
| 8 | CSRF 対策なし。Origin によらず POST を受け付け、クッキーは自動送信される | `bbs.js` L159-219 |
| 9 | アップロード検証が `files.upload.size` の真偽値のみ。大容量でメモリ/ディスク枯渇 | `bbs.js` L164-169 |
| 10 | CSP / `X-Content-Type-Options` / `Referrer-Policy` 等のセキュリティヘッダ欠如 | 全レスポンス |
| 11 | デバッグ用 `console.log` が本番ログに内部情報（アップロードパス、クッキー）を出す | 例: L84, L115, L166 |
| 12 | `bbs.html` は `<head>` のみで body を手組みしており、一貫したエスケープが困難 | `bbs.html` |

### 2.2 Recommended Fixes（Issue 高レベル修正案）

Issue は各指摘に対し 12 件の修正案を提示。要点は (1) `encodeURIComponent`/`decodeURIComponent`
＋ `HttpOnly; Secure; SameSite=Strict`（または `Lax`）、(2) `escapeHtml` ユーティリティによる全出力
エスケープ、(3) 適切な URL 正規表現による `autoLink` 書き換え、(4) `filetype && filetype.indexOf(searchtype) !== -1`、
(5) `?page=2` による明示的ページ指定、(6) モジュールロード時の単一 Pool と終了時クローズ、
(7) `process.env.PORT || 3000`、(8) CSRF トークンまたは `Origin`/`Referer` 検証、(9) サイズ上限と MIME 検証、
(10) 全レスポンスへのセキュリティヘッダ付与、(11) `DEBUG` フラグ後方へのログ抑制、
(12) テンプレートエンジン（EJS, Handlebars 等）への移行。

### 2.3 Additional Notes / Next Steps（Issue 本文）

- スキーマ（`createtable.sql`）は timestamp を主キーとしており、 ordering 容易化のため `SERIAL`/`BIGSERIAL` の追加検討。
- 上限超過時の `DELETE … (SELECT MIN(id) FROM bbs)` はスキーマ変更時に再検討。
- テストスイートが存在せず、回帰検出が困難。
- Next Steps: 「高優先度（クッキー処理・XSS 対策・Pool 管理）を実装する PR を作成する」「チームでレビューし自動テストを追加する」。

---

## 3. 現行実装の調査結果

### 3.1 リポジトリ構成（`git ls-tree origin/master` で確認）

```
Procfile  README.md  bbs.css  bbs.html  bbs.js  createtable.sql  favicon.ico
node_modules/  package-lock.json  package.json
```

- `README.md` は 1 行（`# postgresql-bbs`）のみ。**コーディング規約・設計文書・CONTRIBUTING・CI 設定・`.github` テンプレートは存在しない**（`docs/` `.github/` とも本 PR まで未作成）。
- `.gitignore` が無く、`node_modules` 配下 **164 ファイルが git に追跡済み**（`git ls-files node_modules | wc -l`）。
- `package.json` の宣言: `formidable ^1.2.1` / `npm ^6.13.0` / `pg ^7.12.1`。`scripts.test` は `exit 1`（テストなし）。
- 実インストール（コミット済み `node_modules`）: `pg 7.12.1`、`formidable 1.2.1`、`npm` は未インストール。`package-lock.json` は `lockfileVersion: 1`。
- 既存の開放中 PR: [#1 "Bump semver and pg"](https://github.com/RyoKisoya/postgresql-bbs/pull/1)（`pg ^7.12.1` → `^8.11.0`、非 Draft）。

### 3.2 処理フロー（`bbs.js`、全 239 行）

| 領域 | 実装 | 行 |
|---|---|---|
| 起動 | `http.createServer()`、`listen(port)` | L5, L238 |
| 静的 | 起動時 `readFileSync` した `favicon.ico` / `bbs.css` を URL 部分一致で返す | L15-17, L51-60 |
| GET 一覧 | `getCookie('postname')` で入力欄を復元 → フォーム HTML を `res.write` で生成 → `count(id)` → `row_number()` ページング → 1 件ずつ HTML 出力 | L66-185 |
| POST | `formidable` で multipart 解析 → trim → 添付は `fs.readFileSync` で全量読込 → 上限超過なら最古 1 件 DELETE → `INSERT` → 一時ファイル削除 → `303 /` | L186-232 |
| DB | 全 SQL は `$1..$5` のパラメータ化（L94, L117-121, L219, L227）。**SQL インジェクションの経路は確認されなかった** |

### 3.3 Issue 指摘の現行コードにおける再特定

Issue の行番号参照は一部が現行 `338889f` と一致しない（Issue は別スナップショット基準と推定）。
下表の「現行の実行位置」は本 PR で `grep` / 全文精読により再特定した実測値。

| # | 判定 | 現行の実行位置（`bbs.js`） | 実測根拠 |
|---|---|---|---|
| 1 | **該当**（実測 L25-37） | `setCookie` L25-28（`escape` L26 / `Set-Cookie` L27）、`getCookie` L30-37（`unescape` L36、前方一致置換 L35） | L27 の属性は `postname=<値>` のみ。`HttpOnly`/`Secure`/`SameSite`/`Path` 全て無し |
| 2 | **該当**（実測 L122-147） | `id` L123 → `res.write(id)` L141、`name` L124 → `res.write(name)` L140、`value` L125 → `res.write(...)` L143-144 | `repo` 内に `escapeHtml` / サニタイズ関数は **0 件**（`grep -c 'escapeHtml\|sanitize\|DOMPurify' bbs.js` → `0`） |
| 3 | **該当**（実測 L39-45） | 正規表現 L40、置換 L42 | `h?` + `ttps?` を分離し href を `'h'+href` で復元。`ttp://…` 入力だと表示と href が不一致になる |
| 4 | **部分的に相違**（実測 L131） | `if (filetype.indexOf(searchtype))` | 詳細は §4.3。挙動は結果的に意図通りだが NULL 時にクラッシュ |
| 5 | **該当** L104-105 | `String(req.url).replace(/[^0-9]/g,'')` をページ番号化 | `/prev` `/next` は L98-103、既定は L107-110 |
| 6 | **該当** L64, L234 | `default:` 節先頭 L64 で生成 → GET/POST 全リクエストで Pool 新設。L234 は毎リクエスト `pool.on('drain', pool.end.bind(pool))` | `release()` / `end()` の正常系呼出なし |
| 7 | **該当** L6 | `const port = process.env.PORT;`（`|| 3000` 無し）。L238 で `listen(port)` | 未定義時の挙動は §4.5 |
| 8 | **該当**（実測 L186-232） | `form.parse` L190、`INSERT` L227、上限超過 DELETE L219 | `Origin`/`Referer` 検証なし。`token`/`csrf` の生成・検証は**リポジトリ全体で 0 件** |
| 9 | **該当**（実測 L188-206） | `new IncomingForm()` L188（上限設定なし）、`files.upload.size` L199、`fs.readFileSync` L206、`INSERT` L221-227 | 上限値の定数が存在しない（`maxlength` L11 は**文字数**用） |
| 10 | **該当**（実測 L53, L59, L70, L230） | `writeHead` は 4 箇所のみ、`Content-Type` と `Location` しか設定しない | |
| 11 | **該当**（実測 16 箇所） | L49, 52, 58, 66, 96, 112, 113, 116, 187, 196, 197, 207, 208, 209, 213, 215 | L196-197 は投稿本文、L208 はアップロード実パス |
| 12 | **該当** | `bbs.html` は 5 行（`<head>` のみ）。body は L70-91 と L139-147 の文字列生成 | |

### 3.4 調査で追加確認した事実（Issue 記述の補強）

1. **添付なし POST でプロセスが停止する**（指摘 9 の射程）: L199 `files.upload.size` は、ファイル部が無い `multipart/form-data` で `files.upload === undefined` となり `TypeError`。`form.parse` コールバック（L190）は `err` を一切参照せず、L210 の `try` より前送出のため捕捉されない。`uncaughtException` ハンドラも無い。
2. **part に `Content-Type` が無いとクラッシュ**（同上）: `node_modules/formidable/lib/incoming_form.js` L342 で `part.mime = null`、L371-372 で part の `content-type` ヘッダがある時だけ代入、L207-210 で `type: part.mime`。したがって `files.upload.type === null` が得られ、`bbs.js` L203 の `postdata.trim()` が `TypeError`。
3. **formidable の既定上限は 200 MB**: `incoming_form.js` L27 `maxFieldsSize = 20MB`、L28 `maxFileSize = 200MB`。本アプリは上書きしないため、**1 リクエストで 200 MB を一時ファイル化 → L206 で全量 Buffer → DB `bytea` へ恒久保存**という経路が成立する。
4. **`id` は timestamp 主キー**: `createtable.sql` は `id timestamp default CURRENT_TIMESTAMP primary key`。`bbs.js` の並び順（L118 `order by id desc`）と削除条件（L219 `select min(id)`）は timestamp 順序に依存する。`CURRENT_TIMESTAMP` はトランザクション開始時刻なので、同一トランザクション内の複数 `INSERT` は理論上主キー衝突しうる。
5. **共有可変状態**: `rowCount`（L19）がモジュール共有で、L95 の GET 時にだけ更新され、L102-103 / L160 / L218 で読まれる。並行リクエスト間の干渉でページ判定と**削除判定**が狂う。
6. **OSV 照会結果**: `pg 7.12.1` / `formidable 1.2.1` はいずれも該当アドバイザリなし（`api.osv.dev/v1/query` の応答が `{}`）。ただし OSV の npm カバレッジは限定的で、**本環境に `node`/`npm` が無く `npm audit` は未実行**（`node: command not found`）。依存の要否判断は §11 の確認事項に回す。

### 3.5 検証方法と限界

- 全文精読（`bbs.js` 239 行 / `bbs.html` 5 行 / `createtable.sql` / `Procfile` / `package.json` / `README.md`）と `grep` による機械的な該当箇所特定。
- 依存の実体はコミット済み `node_modules` のソースを直接確認（`formidable/lib/incoming_form.js`, `file.js`）。
- **実行検証は未実施**: `node` / `npm` が未導入のため、起動・リクエスト送信による PoC、テスト実行、`npm audit` は行っていない。全結論は静的解析に基づく。

---

## 4. 問題点と原因

12 指摘は独立ではなく、以下の 5 つの根本原因に集約できる。対策は原因単位で当てる方が改修範囲が小さい。

### 4.1 出力エンコーディングの不在（指摘 2・3・12 の共通原因）

`bbs.js` は DB 値・クッキー値・ファイル名・MIME をそのまま HTML 文字列へ連結する。
エスケープ関数がリポジトリに存在しないため、**安全な箇所がなければ危険な箇所もない**状態であり、
`autoLink`（L39-45）のような「出力生成を兼ねた加工処理」が混在して修正点を分散させている。

- 攻撃経路: 名前欄（L140）・本文欄（L143-144）・`download`/`title` 属性（L133/L136）・入力欄 `value` 属性（L76）。
- 原因: 「生成」と「エスケープ」を同一関数で行う設計。**加工はエスケープ後**という順序規約が無い。

### 4.2 入力検証と不変条件の不在（指摘 1・8・9 の共通原因）

- クッキー: 読取り（L30-37）も書込み（L25-28）も属性・長さ・文字種の制約なし。非推奨 `escape`/`unescape` を使用。
- POST: Origin 由来の区別なし（L186 以降）、CSRF トークンなし、投稿者の概念なし。
- 添付: 上限・MIME・実体（magic bytes）のいずれも未検証（L188-206）。`form.parse` の `err` 未チェック（L190）と
  `files.upload` / `files.upload.type` の NULL 前提欠如（L199, L203）で、**不正入力は 500 でなくプロセス停止**になる。
- 原因: 「入力は常に揃っている」という前提。fail-open（握りつぶし）と fail-closed（拒否）のどちらでもない中途半端な分岐。

### 4.3 真偽値評価の誤用（指摘 4）— Issue の見解との相違点

`bbs.js` L131 `if (filetype.indexOf(searchtype))`（`searchtype = 'image'`、L7）は、
`indexOf` が画像で `0`（falsy）、非画像で `-1`（truthy）を返すため、

- 画像 → `else` 節（L134-137）の `<img>`、非画像 → `if` 節（L132-133）の `<a download>`

となり、**結果は現状ほぼ意図通り**である。Issue の「image と non-image の扱いが入れ替わっている」という
記述は現行コードでは再現せず、実害は (a) 直感に反し `ximage/png` 等の境界で誤分岐、(b) `filetype` が `null` のとき
`TypeError`、に限定される。実装 PR では**挙動変更を伴わない修正**（`!== 0` ではなく `=== 0` への明示化＋NULL ガード）
に留め、Issue 記述との相違をレビューで合意取る（→ §11-3）。

### 4.4 リソースライフサイクル管理の不在（指摘 6、および §3.4-5）

- Pool がリクエスト毎（L64）で、正常系に `end()` しない。代わりに L234 の `drain` で即 `end()` するため、
  「閉じない／早すぎる閉」が混在。毎リクエストの `pool.on(...)` 登録はリスナリーク。
- `rowCount`（L19）の共有可変状態により、削除判定（L218）が別リクエストの値で行動しうる。
- 原因: 接続と状態の所有者（所有期間）が未定義。ハンドラ内でインフラを構築している。

### 4.5 起動時設定の未検証（指摘 7）

`port`（L6）と `DATABASE_URL`（L13）はいずれも未定義でも起動が進行し、
`listen(undefined)` は既定ポート（3000）へフォールバックするため**Heroku 上では誤ったポートで待ち受け**得る
（クラッシュではなくサイレント誤動作）。`DATABASE_URL` 未設定は 1 本目のクエリで初めて表面化する。

### 4.6 レスポンスヘッダとログの扱い（指摘 10・11）

ヘッダ設定が 4 箇所の `writeHead` に分散（L53, L59, L70, L230）し、`console.log` は 16 箇所に散在。
共通の前処理・後処理が無いため、ヘッダ追加とログ抑制を「全経路に漏れなく」適用する手段が現行構造に存在しない。

---

## 5. 設計方針とその根拠

### 5.1 優先度（Issue の Next Steps を基準に、到達可能性で補正）

| 優先 | 対象 | 理由 |
|---|---|---|
| **P0** | 指摘 2（XSS）, 9（アップロード/クラッシュ）, 6（Pool）, 1（クッキー） | Issue が名指しする高優先度（XSS・Pool・クッキー）に加え、**認証不要の単一リクエストでサービスを止められる**経路（§3.4-1, 2, 3）を同値とする |
| **P1** | 指摘 8（CSRF）, 10（ヘッダ）, 7（起動設定）, 5（ページング）, 3（autoLink）, 4（ファイルタイプ判定） | XSS 抑制後は被害が CSRF 経由に集約される。残りは正しさ・運用性 |
| **P2** | 指摘 11（ログ）, 12（テンプレート）, スキーマ見直し | 被害の直接性低／改修範囲大。§11 の確認事項と連動 |

### 5.2 基本原則

1. **依存を増やさない**（既定方針）。`escapeHtml`・ヘッダ付与・Origin 検証は 20 行未満で実装可能であり、
   EJS/Handlebars（Issue 修正案 12）や CSRF ライブラリの導入は新規依存とビュー全面書き換えを生む。
   現行の「依存 3 個（うち 1 個は `npm`）」という最小構成を尊重する。テンプレート化は §11-1 で確認する。
2. **既存の書き方を尊重する**。CommonJS（`require`）、`'use strict'`、タブインデント、
   モジュール直下に関数を置く（`setCookie`/`getCookie`/`autoLink` と同形式）、`const`/`let` の使い分けは現行踏襲。
   ビルド・リンタ・トランスパイルは導入しない（CI 不在のため、追加は §11-5 で確認）。
3. **出力はデフォルトでエスケープ、加工はエスケープ後**。`res.write(escapeHtml(x))` を規約とし、
   生 HTML を書くのは `<br>` 変換とリンク化など**エスケープ後に安全な文字だけを追加する加工**に限定する。
4. **fail-closed**。検証不合格は 4xx を返し、DB 書込み・レスポンス生成に進まない。例外はハンドラ内で捕捉し 500 を返す。
5. **外部仕様の変更は最小限に**。ページング URL（`/2`, `/next`）は閲覧者・ブックマークに可視のため、
   変更は互換維持か明確な移行方針を要する（§10, §11-2）。
6. **DB スキーマ変更は本改修のスコープ外**（Issue は「consider/review」という検討トーン）。
   設計上の影響と移行案を §10 に記載し、判断を待つ。

### 5.3 主要な判断と根拠

| 論点 | 判断 | 根拠 |
|---|---|---|
| CSRF 実装方式 | **`Origin`/`Referer` 検証を一次防御とし、トークン方式は確認事項** | 現行アプリはセッションも状態を持たない（`postname` クッキーは入力欄復元専用）。トークン導入はセッション管理（署名・保存・失効）を新規実装することになり、Issue 修正案 8 の「トークン**または** Origin/Referer 検証」の後者に比べ過大。SameSite 付与（指摘 1）と併せることで既存機能を変えず CSRF 経路を塞げる |
| クッキー属性 | `HttpOnly; Secure; SameSite=Lax; Path=/` | Issue 修正案 1 は `Strict` または `Lax`。`Strict` は外部リンクからの GET で入力復元が失われる（`postname` は UX 目的）ため `Lax` を推奨。`Secure` は Heroku（TLS 終端）前提。要否は §11-4 |
| XSS 対策 | 独自 `escapeHtml`（`& < > " ' ` =` を置換）を全出力経路へ適用 | Issue 修正案 2 と同一。サニタイジングライブラリは依存増加。属性文脈（`value`/`href`/`title`/`download`）と要素内容を同一関数で覆える |
| `autoLink` | 仕様は維持し、**エスケープ後に適用**するよう順序を変更 | `escapeHtml` が `&` を `&amp;` にするため、リンク化を先に置くと二重変換が起きる。現行実装（`h?` 前置）の癖は挙動変更要請が無い限り温存し、URL 候補の抽出のみ正規表現を整理する（Issue 修正案 3 は「適切な正規表現」を求めるため、置換結果の互換性は §11-6 で確認） |
| ページング | `?page=N` を追加し、**既存の `/N`・`/next`・`/prev` は一定期間併存**させる案と、即撤退案を併記 | Issue 修正案 5 は `?page=2` を明示的に要求するが、現行 URL の削除可否は記載がない。後方互換の要否は Product 判断（§11-2） |
| 添付上限 | `form.maxFileSize` / `maxFieldsSize` を上書きし、**INSERT 前にサイズ・MIME を検証** | formidable 既定 200MB（§3.4-3）では DB が確実に枯渇する。上限値の数値は Issue に記載なし → §11-7 |
| Pool | モジュールロード時に 1 つ生成し、`SIGTERM`/`SIGINT` で `end()`、L234 を削除 | Issue 修正案 6 と同一。Heroku はデプロイ毎にプロセス停止のため終了ハンドラが必須 |
| ログ | `DEBUG` 環境変数でゲートし、本文・実パスは出力しない | Issue 修正案 11 と同一。ログ基盤（Heroku syslog）への機微情報送出を止める |

---

## 6. 変更対象ファイル

| ファイル | 種別 | 内容 | 指摘 |
|---|---|---|---|
| `bbs.js` | 修正 | 全 12 指摘の実装本体。ユーティリティ追加、起動処理、GET/POST ハンドラ | 1-11 |
| `bbs.html` | 修正（P2 で要確認） | `<body>` を含めた骨格へ拡張、または現状維持 | 12 |
| `docs/change-designs/issue-2-design.md` | 新規（**本 PR**） | 本書 | — |
| `package.json` | 変更なし（予定） | 依存追加なしを既定。テストランナー導入は §11-5 で確認 | — |
| `createtable.sql` | 変更なし（予定） | スキーマ変更はスコープ外（§5.2-6）。移行案のみ §10 に記載 | Additional Notes |
| `README.md` | 任意 | 必要に応じて環境変数（`PORT`, `DATABASE_URL`, `DEBUG`）の記載を追記 | 7 |

---

## 7. 具体的な変更内容

以下は**設計上の確定形**であり、本 PR では適用しない（行番号は `338889f` 基準）。

### 7.1 共通ユーティリティ（`bbs.js` L38 付近に追加）

```js
const DEBUG = process.env.DEBUG === '1';

function debugLog() {
	if(DEBUG) console.log.apply(console, arguments);
}

function escapeHtml(val) {
	return String(val === undefined || val === null ? '' : val)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
		.replace(/`/g, '&#96;').replace(/=/g, '&#61;');
}

function securityHeaders(res) {
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('Referrer-Policy', 'no-referrer');
	res.setHeader('Content-Security-Policy',
		"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'none'; frame-ancestors 'none'; base-uri 'none'");
}
```

- `securityHeaders(res)` を全 `writeHead`（L53, L59, L70, L230）の直前で呼ぶ → 指摘 10。
- CSP の `img-src ... data:` は現行の `data:` URI 表示（L132-136）に必要。`script-src 'none'` は現行にスクリプトが無い前提（`bbs.html` に `<script>` なし）。
- `console.log` 16 箇所は `debugLog` へ置換し、**L196-197（本文）と L208（実パス）は出力を廃止**して長さ・有無のみ残す → 指摘 11。

### 7.2 起動処理と Pool（L6, L13, L64, L234, L238）

```js
const port = process.env.PORT || 3000;                     // L6
const connectionString = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString: connectionString });  // モジュールロード時へ移動（L64 → L13 付近）

if(require.main === module) {
	if(!connectionString) { console.error('DATABASE_URL is required'); process.exit(1); }
	['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => {
		pool.end().then(() => process.exit(0));
	}));
	main();
}
```

- L64 のリクエスト内 `new pg.Pool(...)` と L234 の `pool.on('drain', pool.end.bind(pool))` を**削除** → 指摘 6。
- 全 SQL は同じ単一 Pool を使用（L94, L121, L219, L227）。

### 7.3 クッキー（L25-37）

```js
function setCookie(key, val, res) {
	const escapedVal = encodeURIComponent(String(val).slice(0, maxlength));
	res.setHeader('Set-Cookie',
		`${key}=${escapedVal}; Path=/; HttpOnly; Secure; SameSite=Lax`);
}
```

- `getCookie` は `decodeURIComponent` を使い、`split('=')` で key/value を分けて**完全一致**で比較（L35 の `replace(`${key}=`,'')` による前方一致を廃止）、取得値は長さを `maxlength` で打ち切る。
- `encodeURIComponent` へ置き換えることで `;`・`,`・CR/LF が符号化され、ヘッダ注入およびクッキー早期終端を防ぐ → 指摘 1。

### 7.4 GET 描画（L76, L122-147）

- L76 入力欄: `value="' + escapeHtml(postname) + '"`。
- L131 判定: `if(filetype && filetype.indexOf(searchtype) === 0) { <a download> } else { <img> }` の形で**意図を明示**し、`filetype` が falsy の場合は添付リンク自体を出さない（§4.3。分岐の向きは現状の挙動を維持する）。
- L132-136: `filetype`・`filename` を `escapeHtml` へ通す。`filetype` は**許可リスト**（`image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml` は XSS リスクにより除外検討 → §11-8）で検証し、リスト外は `data:` URI を生成しない。
- L140-141: `res.write(escapeHtml(name))` / `res.write(escapeHtml(id))`。
- L143-144: `'<div class="values">' + autoLink(escapeHtml(value)).replace(/\r?\n/g, '<br>') + '</div>'` — **エスケープ→リンク化→改行変換**の順序（§5.3）。`autoLink` の正規表現（L40）は `'`・`"`・`<`・`>`・空白を含まない文字クラスを維持し、`https?://` を要求する形に整理する。
- L160 以降のフッタ・ページャ生成（L176）も同様に `escapeHtml` を適用（ページ数等は数値生成のため実害はないが規約を統一）。

### 7.5 POST（L186-232）

```js
} else if(req.method === 'POST') {
	if(!isSameOrigin(req)) { res.writeHead(403, {'Content-Type': 'text/plain'}); res.end('Forbidden'); return; }
	const form = new formidable.IncomingForm();
	form.uploadDir = os.tmpdir();            // L189 の "./" から変更
	form.maxFileSize = maxuploadsize;        // 新設定数（値は §11-7）
	form.maxFieldsSize = maxfieldssize;
	form.parse(req, async function(err, fields, files) {
		if(err) { res.writeHead(400, {'Content-Type': 'text/plain'}); return res.end('Bad Request'); }
		try {
			const postname  = String(fields.name  === undefined ? '' : fields.name).trim();
			const postvalue = String(fields.value === undefined ? '' : fields.value).trim();
			const upload    = files.upload || null;
			const filesize  = upload && upload.size ? upload.size : 0;
			...
		} catch (e) {
			console.error(e);
			res.writeHead(500, {'Content-Type': 'text/plain'}); res.end('Internal Server Error');
		}
	});
}
```

- `isSameOrigin(req)` は `Origin`（無ければ `Referer`）の origin を `Host` と比較し、不一致・解析不能は拒否（fail-closed）。GET/POST のうち**状態を変える POST のみ**対象 → 指摘 8。
- `files.upload` の NULL ガード（L199）と `files.upload.type` の NULL ガード（L202-203）→ §3.4-1, 2 のクラッシュを除去。
- **`fs.readFileSync`（L206）の前に** `filesize <= maxuploadsize` と MIME 許可リストを検証。不合格は 400 を返し `INSERT` しない → 指摘 9。
- `uploadDir` を `"./"`（L189）から既定の一時ディレクトリへ変更（アプリ展開先への書込みを止め、静的配信追加時の露出を予防）。
- L210-216 の `try/catch`（一時ファイル削除）は維持するが、失敗時は `console.error` でログする（現行は L214 の `catch` が情報を捨てている）。
- 削除ロジック（L218-219）は、共有 `rowCount`（L19）ではなく**同一要求内の実測値**または `DELETE` の実行文数で判定するよう変更（§3.4-5。スキーマ変更不要な範囲で、まず `rowCount` のモジュール共有を解消する）。
- `setCookie`（L228）は `postname` が空のときに設定しない、もしくは空値で削除する運用を明示（現行は常に設定）。
- 上記 POST のコード片は**変更箇所を示す抜粋**（現行 L200-216 の全文は省略）。実装 PR では現行ロジックの保持範囲を明示する。

### 7.6 指摘 12（ビュー構造）

`bbs.html` が `<head>` のみである点は、**エスケープ規約（§5.2-3）を全経路に適用できるなら必須ではない**。
本設計では「`bbs.js` 内の文字列生成を維持し、`escapeHtml` を経由しない出力を書かない」という規約で対応し、
テンプレートエンジン導入は確認事項とする（§11-1）。導入する場合の最小構成案は §10 に記載する。

---

## 8. セキュリティ上の考慮事項

### 8.1 脅威モデル（本改修で対象とするもの）

| 脅威 | 現行の成立性 | 対策後 |
|---|---|---|
| 保存型 XSS（閲覧者側でスクリプト実行、クッキー窃取、ページ改ざん） | **成立**（L140, L143-144, L133/L136, L76） | 全出力の `escapeHtml` ＋ CSP `script-src 'none'` で防御 |
| 無認証 POST（CSRF による投稿・既存ログの間接削除） | **成立**（トークン/Origin 検証なし） | `Origin`/`Referer` 検証 ＋ `SameSite=Lax` |
| サービス停止（添付なし POST・part に Content-Type 無し・巨大添付） | **成立**（`TypeError` 未捕捉／既定 200MB） | 入力ガード・`err` 処理・上限検証・`try/catch` |
| DB ストレージ枯渇（`bytea` へ無制限保存） | **成立**（L206 → L227） | INSERT 前のサイズ上限検証 |
| SQL インジェクション | 経路なし（全 SQL パラメータ化） | 現状維持。新 SQL 追加時も `$n` バインディングを規約化 |
| クッキー経由のヘッダ注入 | `escape()` が CR/LF を符号化するため限定的。`;` による早期終端は成立 | `encodeURIComponent` ＋ 属性付与 |
| 情報の漏えい（ログへの本文・実パス） | **成立**（L196-197, L208） | `DEBUG` ゲートと機微フィールドの非出力 |
| MITM による DB トラフィック盗聴 | 未評価（`Procfile`/Heroku 前提のみ）。`new pg.Pool`（L64）に `ssl` 指定なし | §11-9（TLS 設定の要否） |
| 権限昇格・複数ユーザ間の所有権攻撃 | 設計に所有者概念なし（Issue も要求せず） | 本改修のスコープ外（§11-10） |

### 8.2 実装上の注意（レビュー時に確認すべき点）

1. **エスケープの文脈適合**: 要素内容・`value` 属性・`href` 属性・`download`/`title` 属性で同一関数を使う。
   `href` に**ユーザー制御の文字列**（`filetype`）を直接置くのは属性抜け以前のリスク（`javascript:` 等）であり、
   `data:` URI は許可リスト通過時のみ生成する。
2. **二重エンコード**: `autoLink` はエスケープ後に適用する（`&` を含む URL の表示が `&amp;` になるのは仕様上許容、
   実リンク先はブラウザのデコードで復元される）。
3. **fail-closed の徹底**: `Origin` 欠落時に「検証スキップ」としない（curl 等のクライアントは拒否される前提。→ §10 で API 利用への影響を明記）。
4. **エラーレスポンスに内部情報を出さない**: `err.message` / スタックをクライアントへ書かない（ログのみ）。
5. **`Secure` 属性と Heroku**: TLS 終端後の平文 HTTP で `Secure` クッキーは送られるため実運用で問題ないが、
   ローカル開発（`http://localhost`）ではクッキーが無視される。開発時の手順記載が必要（→ §10）。
6. **`rowCount` の共有解消**は機能変更（ページ番号の挙動）を伴うため、テストで現在値との差分を確認する。

---

## 9. テスト方針

**本 PR では実行しない**（`node` / `npm` 未導入、および実装不在のため）。実装 PR で以下を追加・実行する。

### 9.1 単体テスト（Node 標準 `node:test` + `assert`）

依存追加を避けるなら Node 18+ の標準ランナー、許容するなら `devDependencies` にテストランナー（→ §11-5）。

| 対象 | ケース |
|---|---|
| `escapeHtml` | `<script>` / `"` / `'` / `&` / `=` / `` ` `` の置換、`null`・`undefined`・非文字列入力、二重適用時の安定性 |
| `autoLink`（エスケープ後） | `https://example.com?a=1&b=2` の変換、`ttp://x` の従来挙動、URL 偽装（`http://x"/onmouseover=`）で属性が壊れないこと、URL 以外のテキストが変換されないこと |
| `setCookie`/`getCookie` | `;`・`,`・改行を含む値のラウンドトリップ、属性文字列の完全一致、`maxlength` 超の切断 |
| `isSameOrigin` | `Origin` 一致／不一致／欠落時 `Referer` 一致・不一致・両者欠落、`Host` ポート付き、不正 URL |
| 添付検証関数 | 上限ちょうど／超過、`type` が `null`、`files.upload` 欠落、許可外 MIME |

### 9.2 結合テスト（インメモリ HTTP ＋ テスト用 PostgreSQL）

`http.request` で自サーバを呼ぶ回帰として、

- 名前欄に `<img src=x onerror=alert(1)>` を投稿 → 一覧 HTML で `&lt;img` になること、`<script` が混入しないこと。
- ファイル無し POST → **プロセスが生きたまま** 200/303 もしくは 400（現状のクラッシュが再発しないこと）。
- part に `content-type` を付けない multipart → 500 以下で落ちないこと。
- 上限超過の添付 → 400、`bbs` に行が増えていないこと、一時ファイルが残っていないこと。
- 外部 `Origin` の POST → 403、`bbs` 行不変。同一 origin の POST → 303 ＆行追加。
- ページング: `?page=2`（導入時）と既存 `/2`, `/next`, `/prev` の結果が現行と一致すること（§10 の互換方針に合わせる）。
- 並行 POST ×N（`rowCount` 共有の回帰確認）。

### 9.3 手動・運用確認

- Heroku 相当の `PORT` / `DATABASE_URL` / `DEBUG` の combinations 起動確認（未設定時の即終了メッセージを含む）。
- `curl -I` で全エンドポイント（`/`, `/bbs.css`, `/favicon.ico`）のセキュリティヘッダを確認。
- DevTools でクッキー属性（`HttpOnly`/`Secure`/`SameSite`/`Path`）を確認。
- 既存データの閲覧（`filedata` に NULL・`filetype` に NULL を持つ行で落ちないこと）。

### 9.4 完了条件

Issue #2 の 12 指摘それぞれに対し「指摘番号 → 修正箇所 → テストケース」の対応表が通ること。
CI は現在存在しないため、導入可否は §11-5 で確認する。

---

## 10. 既存機能への影響

| 変更 | 影響を受ける既存動作 | 影響の大きさ / 緩和策 |
|---|---|---|
| 全出力の `escapeHtml` | 投稿名・本文に HTML を含めて意図的に装飾していた既存投稿（あれば）が**テキストとして表示**される | 既存データは失われないが**表示が変わる**。`bbs` の既存行に対する表示スナップショット比較を推奨 |
| `autoLink` をエスケープ後へ移動 | `&` を含む URL のリンク**表示**が `&amp;` になる（リンク先は同一） | 見た目の差分。Issue 修正案 3 の「適切な正規表現」との整合を §11-6 で確認 |
| `SameSite=Lax` + `Secure` | 外部サイトからの POST 発火が防止される（＝仕様）。ローカル `http://localhost` では `Secure` クッキーが無視され、入力欄復元が効かない | 開発時は `DEBUG` と同様に `COOKIE_SECURE` のようなフラグで無効化する案を提示（§11-4） |
| `Origin`/`Referer` 検証 | **ヘッダを持たないクライアント（curl 等）からの API 的 POST が 403 になる** | 意図した仕様。現行 README に API 記載はなく、ブラウザ利用のみが前提。自動化利用の有無を §11-11 で確認 |
| `PORT || 3000` | 未設定時の待ち受けポートが 3000 に確定（現行は Node 依存の暗黙動作） | ローカル開発手順が明確化される。Heroku は `PORT` を注入するため影響なし |
| Pool 単一化 | 1 プロセスあたりの DB 接続数が確定制限される（既定 10） | 同時実行数が上回る場合は待機。`pool.on('drain', pool.end)` 削除で「閉じた Pool へのクエリ」エラーが解消される方向 |
| 添付サイズ上限・MIME 許可リスト | 既定 200MB まで添付できた運用が上限超過で 400 になる。許可外 MIME（例: `image/bmp`、`application/pdf`）は添付不可 | **ユーザー-visible な仕様変更**。上限値・許可 MIME は Issue に記載がなく未確定（§11-7, §11-8） |
| `uploadDir` を `"./"` → 一時領域 | 一時ファイルがリポジトリ/アプリ展開先に残る事象がなくなる | デプロイ後の書込み権限要件が変化する（`Procfile` の dyno 書込みは `/tmp` が正規） |
| `?page=N` 導入 | 現行の `/2`, `/next`, `/prev` を残すかにより、ブックマーク・外部リンクの互換性が変わる | 併存案を推奨（§11-2）。併存時は URL 解決順序（`/prev` → `/next` → 数値 → `?page`）を明文化 |
| `rowCount` 共有解消 | 複数タブ同時閲覧時のページ末尾表示・上限超過削除のタイミングが「正確」寄りになる | 挙動差は小さいが、上限 1000 件に達した運用では削除タイミングが変わり得る |
| （検討事項）`SERIAL` 主キー化 | Issue Additional Notes。`order by id desc`（L118）と `min(id)`（L219）のセマンティクスが「時刻順」→「挿入順」に明確化される | 本 PR のスコープ外。移行は既存行への列追加・バックフィル・制約張替が必要 |
| （検討事項）テンプレートエンジン導入 | 全 HTML 生成（L70-91, L139-147）の書き換え | 差分が全ファイルに及ぶ。Issue 修正案 12 だが、まずエスケープ規約で代替（§7.6, §11-1） |

---

## 11. 未確定事項と確認事項

Issue #2 に記載がなく、**本設計で一方的に確定しない**項目。レビュー時に方針を確定する。

| # | 事項 | 本設計の暫定案（決定しない） | 決定者/確認先 |
|---|---|---|---|
| 1 | 指摘 12 のテンプレートエンジン（EJS / Handlebars）導入の要否 | 依存追加を避け `escapeHtml` 規約で代替 | 保守担当者 |
| 2 | 現行ページング URL（`/2`, `/next`, `/prev`）の廃止可否 | `?page=N` 追加＋一定期間併存 | 保守担当者 |
| 3 | 指摘 4 の認識相違（§4.3）— Issue は「分岐が逆」とするが現行コードでは結果は意図通り | 挙動を変えない明示化＋NULL ガードに留める。Issue 記述の修正要否を確認 | Issue 作成者（RyoKisoya） |
| 4 | クッキーの `SameSite`（`Strict` / `Lax`）と `Secure` の適用範囲（ローカル開発の扱い） | `Lax` ＋ `Secure`、開発時は無効化フラグ | 保守担当者 |
| 5 | テスト基盤と CI の導入（Node 標準 `node:test` か外部ランナーか、GitHub Actions 追加の要否） | 標準ランナー、CI 追加は本 PR では行わない | 保守担当者 |
| 6 | `autoLink` の仕様（`ttp://` を受け付ける現行挙動を仕様として維持するか） | 現行互換を維持し、正規表現のみ整理 | 保守担当者 |
| 7 | 添付の上限サイズ（`maxFileSize`）とフォーム全体の上限（`maxFieldsSize`）の数値 | Issue に記載なし。Heroku free / `bytea` 保存を考慮し **2MB / 1MB** を案中 | 保守担当者 |
| 8 | 添付 MIME 許可リストの範囲（`image/svg+xml` はインライン `data:` 表示時に XSS になり得るため除外したい） | `png/jpeg/gif/webp` を許可、`svg` は除外検討 | 保守担当者 |
| 9 | DB 接続の TLS（`ssl: { rejectUnauthorized: true }`）追加の要否と `sslmode` 方針 | 追加推奨（`Procfile` が示すHeroku 前提では TLS 必須になる運用がある） | 運用担当者 |
| 10 | 投稿者の識別・所有者概念、削除権限の導入（Issue は要求していない） | スコープ外 | 保守担当者 |
| 11 | curl 等による非ブラウザ POST の需要有無（`Origin` 検証が 403 を返す仕様の受容） | 検証実施（ブラウザ利用のみが前提） | 保守担当者 |
| 12 | Issue #2 を 1 PR で対応するか、P0 / P1 / P2 で分割するか | **P0（§5.1）→ P1 → P2 の分割**を推奨 | 保守担当者 |
| 13 | 既存 `node_modules` の git 追跡（164 ファイル）・`.gitignore` 不在の是正 | 本 Issue のスコープ外。別 Issue / PR を推奨 | 保守担当者 |
| 14 | 依存更新との順序（開放中の [#1 Bump semver and pg](https://github.com/RyoKisoya/postgresql-bbs/pull/1) が `pg ^8.11.0`） | 実装 PR は #1 のマージ後にリベース（`pg` 7→8 で `Pool` API に破壊的変更はないが、テストの依存が二重変更になる） | 保守担当者 |

---

## 付録: 本書で引用した主要箇所

- `bbs.js` L6（port）, L13（DATABASE_URL）, L19（rowCount）, L25-37（cookie）, L39-45（autoLink）, L53/59/70/230（writeHead）, L64（Pool）, L76（value 属性）, L94-97（count/allPage）, L104-105（ページング）, L117-121（一覧 SQL）, L122-147（描画ループ・`data:` URI）, L160（フッタ条件）, L186-232（POST）, L234（drain）, L238（listen）
- `bbs.html`（全 5 行・`<head>` のみ）
- `createtable.sql`（`id timestamp default CURRENT_TIMESTAMP primary key`, `filedata bytea`）
- `package.json`（`formidable ^1.2.1` / `npm ^6.13.0` / `pg ^7.12.1`, `scripts.test` は `exit 1`）
- `node_modules/formidable/lib/incoming_form.js` L27-30（既定上限・`uploadDir`）, L207-210（`type: part.mime`）, L342/371-372（`part.mime` の初期化と代入）
- Issue [#2](https://github.com/RyoKisoya/postgresql-bbs/issues/2)（本文のみ、コメントなし）







