import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Loader2 } from "lucide-react";
import { ChatMessage, Evidence } from "@/hooks/useMeetingBundle";
import { streamChatWithMeeting } from "@/services/apiClient";
import { useToast } from "@/hooks/use-toast";
import EvidenceChip from "@/components/EvidenceChip";

interface ChatTabProps {
  meetingId: string;
  initialMessages: ChatMessage[];
  speakerMap?: Record<string, string>;
}

interface StreamEvent {
  type: "chunk" | "done" | "error";
  content?: string;
  message?: string;
  message_id?: string;
  evidence_json?: Evidence[];
  created_at?: string;
}

export default function ChatTab({ meetingId, initialMessages, speakerMap }: ChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const question = input.trim();
    setInput("");

    // Optimistic user message
    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      meeting_id: meetingId,
      user_id: null,
      role: "user",
      content: question,
      evidence_json: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);
    setStreamingContent(""); // show streaming bubble immediately

    try {
      const response = await streamChatWithMeeting(meetingId, question);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const raw = trimmed.slice(6);
          let event: StreamEvent;
          try { event = JSON.parse(raw); } catch { continue; }

          if (event.type === "chunk" && event.content) {
            accumulated += event.content;
            setStreamingContent(accumulated);
          } else if (event.type === "done") {
            const assistantMsg: ChatMessage = {
              id: event.message_id ?? `done-${Date.now()}`,
              meeting_id: meetingId,
              user_id: null,
              role: "assistant",
              content: accumulated,
              evidence_json: event.evidence_json ?? null,
              created_at: event.created_at ?? new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setStreamingContent(null);
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Error en el stream");
          }
        }
      }
    } catch (err) {
      setStreamingContent(null);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "No se pudo enviar el mensaje",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[500px]">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 p-4">
        {messages.length === 0 && streamingContent === null && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Haz una pregunta sobre la reunión. Las respuestas estarán basadas en la transcripción.
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg p-3 space-y-2 ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border text-card-foreground"
              }`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              {msg.role === "assistant" && msg.evidence_json && (
                <EvidenceChip evidence={msg.evidence_json as Evidence[]} speakerMap={speakerMap} />
              )}
            </div>
          </div>
        ))}

        {/* Streaming bubble — shows while response is generating */}
        {streamingContent !== null && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg p-3 bg-card border border-border text-card-foreground">
              {streamingContent === "" ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {streamingContent}
                  <span className="inline-block w-0.5 h-3.5 bg-foreground ml-0.5 animate-pulse align-text-bottom" />
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pregunta sobre la reunión..."
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          disabled={sending}
        />
        <Button onClick={handleSend} disabled={sending || !input.trim()} size="icon">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
