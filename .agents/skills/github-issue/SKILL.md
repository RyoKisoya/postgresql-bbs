---
name: github-issue
description: GitHub Issueを日本語で起票する。問題点の起票、バグ報告、改善提案、開発タスクの登録を依頼された場合に使用する。
---

# GitHub Issue起票

## 目的

確認された問題や開発課題をGitHub Issueとして登録する。
起票案の提示だけでは完了としない。

## 作業手順

1. git remote -v で対象リポジトリを確認する。
2. gh auth status で認証状態を確認する。
3. gh issue list --state all で既存Issueを確認する。
4. 対象ソースコードを調査する。
5. 指摘内容の妥当性を検証する。
6. 既存Issueとの重複を確認する。
7. 問題ごとにタイトルと本文を作成する。
8. gh issue create を実際に実行する。
9. gh issue view で起票結果を確認する。
10. gh issue list で全体の結果を確認する。

## Issueの記述形式

タイトルと本文は日本語で記述する。

### 問題の概要

問題の内容を簡潔に記述する。

### 対象ファイル

ファイルパスと行番号を記述する。

### 問題の根拠

実際のソースコードに基づいて記述する。

### 想定される影響

機能、品質、性能、セキュリティへの影響を記述する。

### 修正方針

推奨する修正方法を記述する。

### 完了条件

修正完了を判断できる条件を記述する。

## 制約

- ソースコードを変更しない。
- 既存Issueを無断で変更しない。
- 重複するIssueを作成しない。
- 根拠のない問題を起票しない。
- 認証情報をIssueに含めない。

## 完了条件

- gh issue create が正常終了している。
- 作成したIssue番号とURLを取得している。
- GitHub上にIssueが存在することを確認している。

## 完了報告

以下を日本語で報告する。

- 起票件数
- Issue番号
- タイトル
- URL
- 重複などにより起票しなかった問題と理由

## Issue起票コマンドの実行規約

- Issue本文をシェルの二重引用符で直接渡さない。
- Markdownのバッククォートをコマンド置換させない。
- 本文は一時ファイルに保存する。
- 一時ファイルはmktempで作成する。
- gh issue create --body-file を使用する。
- 起票後は一時ファイルを削除する。

実行例：

```bash
body_file=$(mktemp)

cat > "$body_file" <<'EOF'
## 問題の概要

問題の説明を記述する。

## 対象ファイル

`src/example.js`

## 完了条件

- 修正が完了している。
- テストが成功している。
EOF

gh issue create \
  --title "Issueタイトル" \
  --body-file "$body_file"

result=$?
rm -f "$body_file"
exit "$result"
```

## 再実行時の規約

- エラー発生時もIssueが作成されていないか確認する。
- URLが出力された場合はgh issue viewで確認する。
- 同一タイトルのIssueを繰り返し作成しない。
- 再実行前に既存Issueを確認する。
- 重複Issueを無断で削除・クローズしない。

## 最終検証

- gh issue listで起票結果を確認する。
- gh issue viewで各Issueの本文を確認する。
- git status --shortで作業ツリーを確認する。
- 実際の起票件数を報告する。
- 失敗や重複起票も省略せず報告する。
