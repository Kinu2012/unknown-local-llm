import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

const MODELS = ["gemma3:4b", "llama3.1:8b"];

export default function App() {
  const [memo, setMemo] = useState("");
  const [words, setWords] = useState([]);
  const [model, setModel] = useState(MODELS[0]);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const editor = useRef(null);
  const aborter = useRef(null);

  useEffect(() => {
    if (!loading) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(timer);
  }, [loading]);

  function addSelection() {
    const el = editor.current;
    if (!el) return;
    const selected = el.value.slice(el.selectionStart, el.selectionEnd).trim();
    if (!selected || selected.length > 40) return;
    setWords((old) => old.includes(selected) ? old : [...old, selected]);
  }

  async function explain() {
    if (!words.length || loading) return;
    setLoading(true);
    setResult("");
    setError("");
    aborter.current = new AbortController();
    const context = memo.trim() ? `\n\nメモの文脈:\n${memo.slice(0, 1500)}` : "";
    const prompt = `以下の単語・フレーズを日本語で簡潔に解説してください。${context}\n\n解説する語: ${words.map((w) => `「${w}」`).join("、")}\n\n各語について、意味、この文脈での使われ方、関連概念をMarkdownの見出しで整理してください。`;

    try {
      const response = await fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [
            {
              role: "system",
              content: "あなたは用語解説ツールです。会話相手として振る舞わず、指定された用語の解説だけを出力してください。挨拶、感想、理解できたかの確認、追加質問の募集、『お知らせください』『ご質問があれば』など会話を継続させる文、結びの定型句は一切書かないでください。最後の用語の解説が終わった時点で出力を終了してください。"
            },
            { role: "user", content: prompt }
          ],
          options: { temperature: 0.3 }
        }),
        signal: aborter.current.signal
      });
      if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
      if (!response.body) throw new Error("ストリームを取得できませんでした");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const data = JSON.parse(line);
          answer += data.message?.content || "";
          setResult(answer.replaceAll("&#x20;", ""));
        }
      }
      if (!answer) setError("回答を取得できませんでした。");
    } catch (e) {
      if (e.name !== "AbortError") setError(`Ollamaに接続できません。Ollamaが起動しているか確認してください。(${e.message})`);
    } finally {
      setLoading(false);
      aborter.current = null;
    }
  }

  return <div className="app">
    <header><div className="logo">un<span>known</span></div><div className="tagline">// LOCAL LLM 解説メモ</div></header>
    <main>
      <label>// MEMO</label>
      <textarea ref={editor} value={memo} onChange={(e) => setMemo(e.target.value)} onMouseUp={addSelection} placeholder="メモを書く。分からない語を選択して登録。" />
      <div className="toolbar">
        <button className="secondary" onClick={addSelection}>選択語を登録</button>
        <span>文字を選択してクリック（マウス選択時は自動登録）</span>
      </div>
      <section>
        <label>// 未理解ワード {words.length ? `(${words.length})` : ""}</label>
        <div className="chips">{words.length ? words.map((word) => <span className="chip" key={word}>{word}<button onClick={() => setWords(words.filter((w) => w !== word))}>×</button></span>) : <small>まだ登録なし</small>}</div>
      </section>
      <div className="actions">
        <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select>
        {loading && <button className="stop" onClick={() => aborter.current?.abort()}>中止</button>}
        <button className="primary" disabled={!words.length || loading} onClick={explain}>{loading ? `生成中 ${elapsed.toFixed(1)}秒` : "AI解説を見る"}</button>
      </div>
      {error && <div className="error">{error}</div>}
      {(result || loading) && <article><div className="resultHead"><label>// AI解説 — {model} {loading && <span className="live">● LIVE</span>}</label><button className="clear" onClick={() => { setResult(""); setWords([]); }}>クリア</button></div>{result ? <ReactMarkdown>{result}</ReactMarkdown> : <div className="waiting"><i />モデルを準備しています…</div>}{loading && result && <span className="cursor" />}</article>}
    </main>
    <footer>unknown // Ollama localhost only</footer>
  </div>;
}
