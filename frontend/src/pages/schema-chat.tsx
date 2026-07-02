import { useState, useRef, useEffect } from "react";
import { Send, Database, Loader2, Sparkles, Zap, Bot } from "lucide-react";
import { useAuth } from "@clerk/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { useAppStore } from "@/store/useAppStore";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function SchemaChatPage() {
  const { chatMessages, setChatMessages, currentThreadId, setCurrentThreadId } = useAppStore();
  const messages = chatMessages || [];
  const setMessages = setChatMessages;
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();

  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current;
      setTimeout(() => {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }, 100);
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev: ChatMessage[]) => [...(prev || []), { role: "user", content: userMessage }]);
    setIsLoading(true);
    let assistantMessageAdded = false;

    try {
      const token = await getToken();
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/schema-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: userMessage,
          chat_history: messages,
          thread_id: currentThreadId || undefined,
          timezone_offset: new Date().getTimezoneOffset(),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      setMessages((prev: ChatMessage[]) => [...(prev || []), { role: "assistant", content: "" }]);
      assistantMessageAdded = true;

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) return;

      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.replace("event: ", "").trim();
          } else if (line.startsWith("data: ")) {
            const dataStr = line.replace("data: ", "").trim();
            if (!dataStr) continue;
            
            if (currentEvent === "error") {
              try {
                const errorMsg = JSON.parse(dataStr);
                toast.error(errorMsg);
                setMessages((prev: ChatMessage[]) => {
                  const newMsgs = [...(prev || [])];
                  if (newMsgs[newMsgs.length - 1]?.role === "assistant" && !newMsgs[newMsgs.length - 1].content) {
                    return newMsgs.slice(0, -1);
                  }
                  return newMsgs;
                });
              } catch (e) {}
              continue;
            }

            try {
              const data = JSON.parse(dataStr);
              if (data.thread_id && !currentThreadId) {
                setCurrentThreadId(data.thread_id);
              } else if (typeof data === "string" && currentEvent !== "error") {
                setMessages((prev: ChatMessage[]) => {
                  const newMsgs = [...(prev || [])];
                  const last = newMsgs[newMsgs.length - 1];
                  if (last && last.role === "assistant") {
                    last.content += data;
                  }
                  return newMsgs;
                });
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      toast.error("Failed to communicate with AI");
      if (assistantMessageAdded) {
        setMessages((prev: ChatMessage[]) => (prev || []).slice(0, -1));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full flex w-full bg-[#0a0a0a] relative overflow-hidden font-sans">
      {/* Background Ambient Glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[20%] left-[50%] -translate-x-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full mix-blend-screen filter blur-[150px] opacity-60 animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-blue-500/10 rounded-full mix-blend-screen filter blur-[120px] opacity-40"></div>
      </div>

      {/* Main Chat Area - 100% Width */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative z-10 w-full">
        
        <div className="flex-1 flex flex-col min-h-0 w-full max-w-5xl mx-auto px-4 md:px-8">
          
          <ScrollArea className="flex-1 w-full pt-12" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="h-full min-h-[75vh] flex flex-col items-center justify-center animate-in fade-in zoom-in duration-1000">
                <div className="relative mb-8 group">
                  <div className="absolute inset-0 bg-primary/30 blur-3xl rounded-full scale-150 transition-all duration-700 group-hover:scale-[2.0] group-hover:bg-primary/40"></div>
                  <div className="relative bg-black/40 border border-white/10 p-6 rounded-[2rem] shadow-2xl flex items-center justify-center backdrop-blur-xl">
                    <Bot className="w-16 h-16 text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]" />
                    <Sparkles className="absolute -top-4 -right-4 w-8 h-8 text-yellow-400 animate-pulse drop-shadow-[0_0_10px_rgba(250,204,21,0.8)]" />
                  </div>
                </div>
                
                <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 text-center bg-gradient-to-br from-white via-white/90 to-white/40 bg-clip-text text-transparent drop-shadow-sm">
                  Hi Sir, I am QuerySage ✨
                </h1>
                
                <p className="text-lg md:text-xl text-muted-foreground/80 text-center max-w-2xl mb-12 font-medium leading-relaxed">
                  Your autonomous database engineer. I monitor health, optimize complex queries, and defend against threats. <br/><span className="text-white/60">Just tell me what you need. 🚀</span>
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-3xl">
                  <Button variant="outline" className="justify-start h-auto p-5 bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/20 transition-all duration-300 text-left flex-col items-start group rounded-2xl" onClick={() => setInput("Can you find any slow queries affecting performance?")}>
                    <span className="font-semibold flex items-center text-white/90 group-hover:text-white text-base"><Zap className="w-5 h-5 mr-3 text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.6)]"/> Run Performance Diagnostics</span>
                    <span className="text-sm text-white/40 mt-1.5 ml-8">Analyze pg_stat_statements for bottlenecks</span>
                  </Button>
                  <Button variant="outline" className="justify-start h-auto p-5 bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/20 transition-all duration-300 text-left flex-col items-start group rounded-2xl" onClick={() => setInput("Analyze my schema and suggest missing indexes.")}>
                    <span className="font-semibold flex items-center text-white/90 group-hover:text-white text-base"><Database className="w-5 h-5 mr-3 text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]"/> Schema Analysis</span>
                    <span className="text-sm text-white/40 mt-1.5 ml-8">Check for missing structural optimizations</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-8 py-8 pb-40 w-full max-w-4xl mx-auto">
                {messages.map((msg: ChatMessage, idx: number) => (
                  <div
                    key={idx}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] md:max-w-[80%] rounded-[2rem] px-7 py-5 text-[16px] leading-relaxed shadow-xl ${
                        msg.role === "user"
                          ? "bg-white/10 text-white rounded-tr-sm border border-white/5 backdrop-blur-md"
                          : "bg-transparent text-white/90 rounded-tl-sm"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <div className="whitespace-pre-wrap font-medium">{msg.content}</div>
                      ) : (
                        <div className="prose prose-base md:prose-lg dark:prose-invert max-w-none prose-p:leading-loose prose-pre:bg-white/5 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl prose-pre:backdrop-blur-md">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isLoading && messages[messages.length - 1]?.role === "user" && (
                  <div className="flex justify-start pl-4">
                    <div className="bg-transparent rounded-3xl rounded-tl-sm px-6 py-5 flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full bg-white/50 animate-bounce shadow-[0_0_10px_rgba(255,255,255,0.5)]"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-white/50 animate-bounce delay-75 shadow-[0_0_10px_rgba(255,255,255,0.5)]"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-white/50 animate-bounce delay-150 shadow-[0_0_10px_rgba(255,255,255,0.5)]"></div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
          
          {/* Docked Input Box */}
          <div className="absolute bottom-0 left-0 right-0 p-6 pt-12 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a] to-transparent z-20">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="relative max-w-4xl mx-auto shadow-[0_0_40px_rgba(0,0,0,0.5)] rounded-full group"
            >
              <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/30 to-blue-500/30 rounded-full blur opacity-50 group-hover:opacity-100 transition duration-500"></div>
              <Input
                placeholder="Ask QuerySage to optimize a query, check logs, or build a table..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isLoading}
                className="relative w-full rounded-full pl-8 pr-16 h-16 border border-white/10 bg-black/60 backdrop-blur-2xl focus-visible:ring-0 focus-visible:border-white/30 text-lg text-white shadow-inner placeholder:text-white/30"
              />
              <Button 
                type="submit" 
                disabled={!input.trim() || isLoading}
                size="icon"
                className="absolute right-2 top-2 rounded-full h-12 w-12 bg-white text-black hover:bg-white/90 shadow-[0_0_15px_rgba(255,255,255,0.3)] transition-all active:scale-95 disabled:bg-white/20 disabled:text-white/40"
              >
                <Send className="w-5 h-5 ml-1" />
              </Button>
            </form>
            <div className="text-center mt-4">
              <span className="text-xs text-white/30 tracking-wider font-medium uppercase">QuerySage AI can make mistakes. Always verify destructive commands.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
