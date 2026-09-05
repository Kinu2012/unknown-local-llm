import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

const MODELS = ["gemma3:4b", "llama3.1:8b"];

export default function App() {
  const [memo, setMemo] = useState("");
  const [words, setWords] = useState([]);
  const [model, setModel] = useState(MODELS[0]);
  const [cards, setCards] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const editor = useRef(null);
  const aborter = useRef(null);

  function addSelection() {
    const el = editor.current;
    if (!el) return;
    const selected = el.value.slice(el.selectionStart, el.selectionEnd).trim();
    if (!selected || selected.length > 40) return;
    setWords((old) => old.includes(selected) ? old : [...old, selected]);
  }

  function updateCard(word, patch) {
    setCards((old) => old.map((card) => card.word === word ? { ...card, ...patch } : card));
  }

  async function explainWord(word, signal) {
    const context = memo.trim() ? memo.slice(0, 1500) : "（文脈なし）";
    const prompt = `用語「${word}」を日本語で簡潔に解説してください。\n\nメモの文脈:\n${context}\n\n「意味」「この文脈での役割」「関連概念」の3見出しだけを使ってください。該当情報がなければ無理に埋めないでください。`;
    const response = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({
        model, stream: true,
        messages: [
          { role: "system", content: "あなたは一方向の用語解説ツールです。挨拶、感想、質問、追加案内、会話的な結びは書かず、指定された用語の解説だけを出力してください。" },
          { role: "user", content: prompt }
        ],
        options: { temperature: 0.2 }
      })
    });
    if (!response.ok) throw new Error(`Ollama ${response.status}`);
    if (!response.body) throw new Error("ストリームを取得できませんでした");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", answer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        answer += JSON.parse(line).message?.content || "";
        updateCard(word, { text: answer.replaceAll("&#x20;", "") });
      }
    }
    if (!answer) throw new Error("回答が空でした");
  }

  async function explainAll() {
    if (!words.length || running) return;
    const controller = new AbortController();
    aborter.current = controller;
    setRunning(true);
    setProgress({ current: 0, total: words.length });
    setCards(words.map((word) => ({ word, text: "", status: "waiting", seconds: 0 })));
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index], started = Date.now();
      setProgress({ current: index + 1, total: words.length });
      updateCard(word, { status: "running" });
      const timer = setInterval(() => updateCard(word, { seconds: (Date.now() - started) / 1000 }), 100);
      try {
        await explainWord(word, controller.signal);
        updateCard(word, { status: "done", seconds: (Date.now() - started) / 1000 });
      } catch (error) {
        updateCard(word, { status: error.name === "AbortError" ? "stopped" : "error", error: error.message });
        if (error.name === "AbortError") { clearInterval(timer); break; }
      }
      clearInterval(timer);
    }
    setRunning(false);
    aborter.current = null;
  }

  return <div className="app">
    <header><div className="logo">un<span>known</span></div><div className="tagline">// LOCAL LLM 解説メモ</div></header>
    <main>
      <label>// MEMO</label>
      <textarea ref={editor} value={memo} onChange={(e) => setMemo(e.target.value)} onMouseUp={addSelection} placeholder="メモを書く。分からない語を選択して登録。" />
      <div className="toolbar"><button className="secondary" onClick={addSelection}>選択語を登録</button><span>文字を選択してクリック（マウス選択時は自動登録）</span></div>
      <section><label>// 未理解ワード {words.length ? `(${words.length})` : ""}</label><div className="chips">{words.length ? words.map((word) => <span className="chip" key={word}>{word}<button onClick={() => setWords(words.filter((w) => w !== word))}>×</button></span>) : <small>まだ登録なし</small>}</div></section>
      <div className="actions">
        <select value={model} disabled={running} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select>
        {running && <button className="stop" onClick={() => aborter.current?.abort()}>中止</button>}
        <button className="primary" disabled={!words.length || running} onClick={explainAll}>{running ? `${progress.current} / ${progress.total}語を処理中` : "AI解説を見る"}</button>
      </div>
      {!!cards.length && <div className="resultsGrid">{cards.map((card) => <article key={card.word} className={card.status}>
        <div className="resultHead"><h2>{card.word}</h2><span>{card.status === "waiting" ? "待機中" : card.status === "running" ? `● 生成中 ${card.seconds.toFixed(1)}秒` : card.status === "done" ? `完了 ${card.seconds.toFixed(1)}秒` : card.status === "stopped" ? "中止" : "失敗"}</span></div>
        {card.text ? <ReactMarkdown>{card.text}</ReactMarkdown> : card.status === "running" ? <div className="waiting"><i />モデルを準備しています…</div> : null}
        {card.error && <div className="error">{card.error}</div>}
        {card.status === "running" && card.text && <span className="cursor" />}
      </article>)}</div>}
    </main>
    <footer>unknown // Ollama localhost only</footer>
  </div>;
}
