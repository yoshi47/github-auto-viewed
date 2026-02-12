# GitHub Auto Viewed (Generated Files)

---

## English

A Chrome extension that automatically marks generated files as "Viewed" on GitHub PR's Files changed page. Works on both Files changed and Changes tabs.

### Example patterns

You can configure patterns for auto-viewed files. Default is empty — you need to add patterns yourself.

- `*/gen/*` — Files whose path contains `gen`
- `*openapi.gen.d.ts` — Specific generated file
- `*.lock` — Lock files
- `src/generated/*` — Files under a specific directory
- `*.pb.go` — Protocol Buffers generated files

### Pattern customization

Click the extension icon to open the popup and edit the auto-viewed patterns.

**Global tab:** Patterns applied to all repositories.

**Repository tab:** Patterns applied only to the current repository (the PR page you have open). If you open the popup from a non-PR page, you'll see "Open a GitHub Pull Request page to configure repository-specific patterns."

**Common:**
- One pattern per line
- Use `*` as wildcard (glob-style)
- Settings are stored in `chrome.storage.sync` and sync across devices when signed into Chrome

### Installation

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `github-auto-viewed` folder

### Reload after code changes

Click the reload icon on the extension card or press `Ctrl+R` (Mac: `Cmd+R`) on the card.

### Troubleshooting

- If it doesn't work, check Console logs prefixed with `[auto-viewed]`
- If you see `No diff containers found`, GitHub's DOM may have changed — update the selectors in `contentScript.js`

---

## 日本語

GitHub PRの「Files changed」画面で、生成ファイルを自動的に「Viewed」にするChrome拡張。Files changed または Changes タブで動作します。

### 対象ファイルの例

以下のようなパターンで、自動Viewedの対象を設定できます（デフォルトは空。ユーザーが設定する必要があります）。

- `*/gen/*` — パスに `gen` を含むファイル
- `*openapi.gen.d.ts` — 特定の生成ファイル
- `*.lock` — ロックファイル
- `src/generated/*` — 特定ディレクトリ配下
- `*.pb.go` — Protocol Buffers の生成ファイル

### パターンのカスタマイズ

拡張アイコンをクリックするとポップアップが開き、自動Viewedの対象パターンを編集できます。

**Global タブ:** 全リポジトリに適用されるパターンを設定します。

**Repository タブ:** 現在開いている GitHub PR のリポジトリにのみ適用されるパターンを設定します。PR ページ以外でポップアップを開いた場合は「Open a GitHub Pull Request page to configure...」と表示され、設定できません。

**共通:**
- 1行に1パターン
- `*` をワイルドカードとして使用（glob風）
- 設定は `chrome.storage.sync` に保存され、Chromeアカウントでログインしていればデバイス間で同期されます

### インストール

1. `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `github-auto-viewed` フォルダを選択

### コード変更後のリロード

`chrome://extensions` で本拡張の更新ボタン（リロードアイコン）をクリック、またはカード上で `Ctrl+R`。

### トラブルシューティング

- 動作しない場合、DevTools Console で `[auto-viewed]` のログを確認
- `No diff containers found` と出る場合、GitHub側のDOM構造が変わった可能性がある。`contentScript.js` のセレクタを更新する
