import fs from "node:fs";
import path from "node:path";

loadEnv(path.join(process.cwd(), ".env.local"));

const config = {
  token: process.env.NOTION_TOKEN,
  dataSourceId: cleanId(process.env.NOTION_DATA_SOURCE_ID || ""),
  databaseId: cleanId(process.env.NOTION_DATABASE_ID || ""),
  model: process.env.OLLAMA_MODEL || "gemma3:4b",
  ollamaUrl: (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
  interval: Number(process.env.POLL_INTERVAL_MS || 5000),
  properties: {
    word: process.env.NOTION_WORD_PROPERTY || "用語",
    context: process.env.NOTION_CONTEXT_PROPERTY || "文脈",
    result: process.env.NOTION_RESULT_PROPERTY || "解説",
    status: process.env.NOTION_STATUS_PROPERTY || "状態",
    model: process.env.NOTION_MODEL_PROPERTY || "使用モデル"
  }
};

if (!config.token || (!config.dataSourceId && !config.databaseId)) {
  console.error(".env.local に NOTION_TOKEN と NOTION_DATABASE_ID（またはNOTION_DATA_SOURCE_ID）を設定してください。");
  process.exit(1);
}

const once = process.argv.includes("--once");
let busy = false;

async function notion(endpoint, options = {}) {
  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Notion-Version": "2026-03-11",
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  if (!response.ok) throw new Error(`Notion ${response.status}: ${await response.text()}`);
  return response.json();
}

function plain(property) {
  if (!property) return "";
  const value = property[property.type];
  if (Array.isArray(value)) return value.map((part) => part.plain_text || part.text?.content || "").join("");
  if (value && typeof value === "object") return value.name || "";
  return typeof value === "string" ? value : "";
}

function richText(text) {
  return String(text).match(/[\s\S]{1,1900}/g)?.map((content) => ({ type: "text", text: { content } })) || [];
}

function propertyValue(type, text) {
  if (type === "title") return { title: richText(text) };
  if (type === "rich_text") return { rich_text: richText(text) };
  if (type === "select") return { select: { name: text } };
  if (type === "status") return { status: { name: text } };
  throw new Error(`未対応のNotion列タイプ: ${type}`);
}

async function patchPage(pageId, schema, values) {
  const properties = {};
  for (const [name, text] of Object.entries(values)) {
    const definition = schema[name];
    if (definition && text !== undefined) properties[name] = propertyValue(definition.type, text);
  }
  await notion(`/pages/${pageId}`, { method: "PATCH", body: JSON.stringify({ properties }) });
}

async function explain(word, context) {
  const prompt = `用語「${word}」を日本語で簡潔に解説してください。\n\nメモの文脈:\n${context || "（文脈なし）"}\n\n「意味」「この文脈での役割」「関連概念」の3見出しだけを使ってください。会話的な結び、質問、追加案内は書かず、解説終了時点で出力を終えてください。`;
  const response = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      messages: [
        { role: "system", content: "あなたは一方向の用語解説ツールです。指定された形式の解説以外は出力しません。" },
        { role: "user", content: prompt }
      ],
      options: { temperature: 0.2 }
    })
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return (data.message?.content || "").replaceAll("&#x20;", "").trim();
}

async function cycle() {
  if (busy) return;
  busy = true;
  try {
    if (!config.dataSourceId) {
      const database = await notion(`/databases/${config.databaseId}`);
      config.dataSourceId = database.data_sources?.[0]?.id;
      if (!config.dataSourceId) throw new Error("データベース内のData sourceを取得できませんでした。");
      console.log(`Data sourceを検出: ${config.dataSourceId}`);
    }
    const source = await notion(`/data_sources/${config.dataSourceId}`);
    const schema = source.properties;
    const { word, context, result, status, model } = config.properties;
    for (const required of [word, context, result, status]) {
      if (!schema[required]) throw new Error(`Notionに「${required}」列がありません。`);
    }

    const queried = await notion(`/data_sources/${config.dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, sorts: [{ timestamp: "created_time", direction: "ascending" }] })
    });
    const queue = queried.results.filter((page) => plain(page.properties[status]) === "未処理");
    if (!queue.length) {
      console.log(`[${new Date().toLocaleTimeString()}] 未処理の用語はありません`);
      return;
    }

    for (const page of queue) {
      const term = plain(page.properties[word]).trim();
      const memo = plain(page.properties[context]).trim();
      if (!term) continue;
      console.log(`生成中: ${term}`);
      try {
        await patchPage(page.id, schema, { [status]: "生成中", [model]: config.model });
        const answer = await explain(term, memo);
        await patchPage(page.id, schema, { [result]: answer, [status]: "完了", [model]: config.model });
        console.log(`完了: ${term}`);
      } catch (error) {
        console.error(`失敗: ${term}\n${error.message}`);
        await patchPage(page.id, schema, { [status]: "失敗" }).catch(() => {});
      }
    }
  } finally {
    busy = false;
  }
}

function cleanId(value) {
  return value.trim().replaceAll("-", "").replace(/^.*?([0-9a-f]{32}).*$/i, "$1");
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

await cycle().catch((error) => { console.error(error.message); if (once) process.exitCode = 1; });
if (!once) {
  console.log(`${config.interval / 1000}秒ごとにNotionを確認します。Ctrl+Cで終了。`);
  setInterval(() => cycle().catch((error) => console.error(error.message)), config.interval);
}
