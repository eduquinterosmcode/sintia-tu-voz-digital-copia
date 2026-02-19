import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Loader2, Quote } from "lucide-react";
import { ChatMessage, Evidence } from "@/hooks/useMeetingBundle";
import { chatWithMeeting } from "@/services/apiClient";
import { useToast } from "@/hooks/use-toast";
import EvidenceChip from "@/components/EvidenceChip";

interface ChatTabProps {
  meetingId: string;
  initialMessages: ChatMessage[];
  speakerMap?: Record<string, string>;
}

export default function ChatTab({ meetingId, initialMessages, speakerMap }: ChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

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

    try {
      const result = await chatWithMeeting(meetingId, question);
      const assistantMsg: ChatMessage = {
        id: result.message.id,
        meeting_id: meetingId,
        user_id: null,
        role: "assistant",
        content: result.message.content,
        evidence_json: result.message.evidence_json,
        created_at: result.message.created_at,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
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
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Haz una pregunta sobre la reunión. Las respuestas estarán basadas en la transcripción.
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
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
        {sending && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-lg p-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
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
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
