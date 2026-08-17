import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { AgentMessage } from "../types";
import { Card } from "../components/Card";

const SUGGESTIONS = [
  "How much did we spend on vet bills?",
  "What's our total spend this year?",
  "What's pending review?",
  "What has the agent learned?",
];

export function AssistantPage() {
  const [params] = useSearchParams();
  const [messages, setMessages] = useState<AgentMessage[]>([
    { role: "agent", text: "Hi! I'm the Fiscus agent. I have persistent memory of this org's documents and corrections. Ask me about spending, categories, or what's pending." },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const lastTopic = useRef<string>("");
  const endRef = useRef<HTMLDivElement>(null);
  const askedFromLink = useRef(false);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking]);

  async function send(text: string) {
    if (!text.trim() || thinking) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setThinking(true);
    // Follow-up context: "what about X" / bare short questions inherit the last topic.
    // Stands in for C2 session memory until the real agent carries the conversation state.
    let effective = text;
    const followUp = /^(what about|and|how about)\b/i.test(text.trim()) || text.trim().split(/\s+/).length <= 3;
    if (followUp && lastTopic.current) effective = `${lastTopic.current} ${text}`;
    else lastTopic.current = text;
    const reply = await api.askAgent(effective);
    setThinking(false);
    setMessages((m) => [...m, reply]);
  }

  // Deep-link support: /assistant?q=... auto-asks (used by dashboard preset chips).
  useEffect(() => {
    const q = params.get("q");
    if (q && !askedFromLink.current) {
      askedFromLink.current = true;
      send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Ask the agent</h1>
        <p className="mt-1 text-sm text-faint">
          Backed by the Bedrock agent with CockroachDB as persistent memory (issues C1-C4).
        </p>
      </div>

      <Card className="flex h-[460px] flex-col p-0">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${m.role === "user" ? "bg-moss text-white" : "border border-hairline bg-paper text-ink"}`}>
                <p>{m.text}</p>
                {m.citations && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.citations.map((c) => (
                      <span key={c} className="rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] text-faint ring-1 ring-hairline">{c}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-hairline bg-paper px-4 py-2 text-sm text-faint">
                <span className="inline-flex gap-1">
                  <span className="animate-pulse">·</span>
                  <span className="animate-pulse [animation-delay:150ms]">·</span>
                  <span className="animate-pulse [animation-delay:300ms]">·</span>
                </span>{" "}
                checking the ledger
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-hairline p-4">
          <div className="mb-2 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-full border border-hairline px-3 py-1 text-xs text-faint hover:border-stone-300 hover:text-ink">{s}</button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about spending, categories, pending items…"
              className="flex-1 rounded-full border border-hairline bg-surface px-4 py-2 text-sm"
            />
            <button type="submit" disabled={thinking} className="rounded-full bg-moss px-4 py-2 text-sm font-semibold text-white hover:bg-moss-dark disabled:opacity-40">Send</button>
          </form>
        </div>
      </Card>
    </div>
  );
}
