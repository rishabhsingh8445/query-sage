import { useState, useRef, useEffect } from "react";
import { MessageSquare, Send, Loader2, Bot, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function ChatInterface({ historyId, initialChatHistory = [] }: { historyId: number, initialChatHistory?: ChatMessage[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialChatHistory);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput("");
    
    const newMessages: ChatMessage[] = [...messages, { role: "user", content: userMessage }];
    setMessages([...newMessages, { role: "assistant", content: "" }]);
    setIsStreaming(true);

    try {
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ history_id: historyId, message: userMessage })
      });

      if (!res.ok) {
        throw new Error("Failed to send message");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No readable stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let streamedResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || ""; 

        for (const part of parts) {
          const lines = part.split("\n");
          let eventType = "message";
          let data = "";
          
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.substring(7);
            else if (line.startsWith("data: ")) data = line.substring(6);
          }

          if (data && eventType === "chunk") {
            try {
              const parsedData = JSON.parse(data);
              streamedResponse += parsedData;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: streamedResponse };
                return updated;
              });
            } catch(e) {}
          }
        }
      }
    } catch (err: any) {
      toast({
        title: "Chat Error",
        description: err.message || "Something went wrong.",
        variant: "destructive"
      });
      setMessages(newMessages); // Revert assistant message
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div className="flex flex-col border border-border rounded-lg bg-card overflow-hidden mt-6">
      <div className="bg-muted/50 p-3 border-b border-border flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">AI Follow-up Chat</h3>
      </div>
      
      <ScrollArea className="flex-1 p-4 max-h-[300px] min-h-[200px]" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm py-10 opacity-70">
            <Bot className="h-8 w-8 mb-2 opacity-50" />
            <p>Ask a follow-up question about this query.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={cn("flex items-start gap-3 text-sm", msg.role === "user" ? "flex-row-reverse" : "")}>
                <div className={cn("shrink-0 rounded-full p-2", msg.role === "assistant" ? "bg-primary/20 text-primary" : "bg-muted text-foreground")}>
                  {msg.role === "assistant" ? <Bot className="h-4 w-4" /> : <UserIcon className="h-4 w-4" />}
                </div>
                <div className={cn("rounded-lg px-4 py-2 max-w-[80%]", msg.role === "assistant" ? "bg-muted/30" : "bg-primary text-primary-foreground")}>
                  {msg.content || (isStreaming && idx === messages.length - 1 ? <Loader2 className="h-4 w-4 animate-spin opacity-50" /> : "")}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <form onSubmit={handleSubmit} className="p-3 border-t border-border bg-background flex gap-2">
        <Input 
          value={input} 
          onChange={(e) => setInput(e.target.value)} 
          placeholder="e.g., Can you explain why you added that index?" 
          disabled={isStreaming}
          className="flex-1 focus-visible:ring-primary/50"
        />
        <Button type="submit" size="icon" disabled={isStreaming || !input.trim()}>
          {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
