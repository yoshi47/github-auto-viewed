# GitHub Auto Viewed (Generated Files)

GitHub PRの「Files changed」画面で、生成ファイルを自動的に「Viewed」にするChrome拡張。

## 対象ファイル（デフォルト）

- パスに `/gen/` を含むファイル
- `openapi.gen.d.ts` で終わるファイル
- `swagger.json` で終わるファイル

## パターンのカスタマイズ

拡張アイコンをクリックするとポップアップが開き、自動Viewedの対象パターンを編集できます。

- 1行に1パターン
- `*` をワイルドカードとして使用（glob風）
- 例: `*/gen/*`, `*openapi.gen.d.ts`, `*.lock`

デフォルトパターンに戻すには「Reset to defaults」ボタンをクリックします。設定は `chrome.storage.sync` に保存され、Chromeアカウントでログインしていればデバイス間で同期されます。

## インストール

1. `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `tools/chrome-extension/github-auto-viewed/` フォルダを選択

## コード変更後のリロード

`chrome://extensions` で本拡張の更新ボタン（リロードアイコン）をクリック、またはカード上で `Ctrl+R`。

## トラブルシューティング

- 動作しない場合、DevTools Console で `[auto-viewed]` のログを確認
- `No .js-file containers found` と出る場合、GitHub側のDOM構造が変わった可能性がある。`contentScript.js` のセレクタを更新する
