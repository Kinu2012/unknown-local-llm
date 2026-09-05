# unknown — local LLM memo (alpha)

Ollamaで `gemma3:4b` または `llama3.1:8b` を使うローカルメモです。

メモ内で選択した未理解語を、一語ずつ順番にローカルLLMで解説します。複数語の回答は独立したカードとして表示され、入力したメモは外部AI APIへ送信されません。フォントを含む画面表示にも外部配信サービスを使用しません。

## 起動

Ollamaアプリを起動した状態で、このフォルダのPowerShellから実行します。

```powershell
npm install
npm run dev
```

表示された `http://localhost:5173` をブラウザで開いてください。入力内容はOllamaのローカルAPIだけへ送られます。

## Notion連携（Experimental）

この機能は試作段階であり、通常利用に必要ありません。Notion APIの設定と動作確認が必要です。

Notionにデータベースを作り、次の列を用意します。

| 列名 | 種類 | 値 |
|---|---|---|
| 用語 | タイトル | 調べたい語 |
| 文脈 | テキスト | 周辺の文章 |
| 解説 | テキスト | 自動入力 |
| 状態 | セレクトまたはステータス | 未処理・生成中・完了・失敗 |
| 使用モデル | テキスト | 自動入力（省略可） |

1. Notionで内部インテグレーションを作成し、対象データベースへ接続します。
2. `.env.example` を `.env.local` という名前でコピーします。
3. `.env.local` にトークンとNotionデータベースのURLを設定します。
4. `npm run notion` を実行します。

「状態」が「未処理」の行を古い順に一語ずつOllamaで処理し、「解説」へ書き戻します。一度だけ確認する場合は `npm run notion:once` を使います。

## License

MIT License
