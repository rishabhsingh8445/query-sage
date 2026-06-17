import { useState, useRef, useEffect } from "react";
import { MessageSquare, Send, Database, Loader2, Plus, Trash2, Menu } from "lucide-react";
import { useAuth } from "@clerk/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { useAppStore } from "@/store/useAppStore";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type Thread = {
  id: string;
  title: string;
  createdAt: string;
};

export default function SchemaChatPage() {
  const { chatMessages, setChatMessages, currentThreadId, setCurrentThreadId } = useAppStore();
  const messages = chatMessages || [];
  const setMessages = setChatMessages;
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    fetchThreads();
  }, []);

  const fetchThreads = async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/schema-chat/threads`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setThreads(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadThread = async (id: string) => {
    setCurrentThreadId(id);
    setIsSidebarOpen(false);
    try {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/schema-chat/threads/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (e) {
      toast.error("Failed to load thread");
    }
  };

  const deleteThread = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const token = await getToken();
      await fetch(`${import.meta.env.VITE_API_URL}/api/schema-chat/threads/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (currentThreadId === id) {
        startNewChat();
      }
      fetchThreads();
    } catch (e) {
      toast.error("Failed to delete thread");
    }
  };

  const startNewChat = () => {
    setCurrentThreadId(null);
    setMessages([]);
    setIsSidebarOpen(false);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
                  // Remove the blank assistant message we added
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
              if (data.thread_id) {
                setCurrentThreadId(data.thread_id);
                fetchThreads(); // Refresh thread list
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

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-muted/20 border-r border-border p-4 w-full">
      <Button onClick={startNewChat} className="mb-6 w-full justify-start gap-2 shadow-sm rounded-xl h-11" variant="default">
        <Plus className="w-5 h-5" />
        New Chat
      </Button>
      
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
        Recent Chats
      </div>
      
      <ScrollArea className="flex-1 -mx-2 px-2">
        <div className="space-y-1">
          {threads.length === 0 && (
            <div className="text-sm text-muted-foreground p-2">No history yet.</div>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              onClick={() => loadThread(t.id)}
              className={`group flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors ${
                currentThreadId === t.id ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <MessageSquare className="w-4 h-4 shrink-0 opacity-70" />
                <span className="truncate text-sm">{t.title}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 h-7 w-7 transition-opacity"
                onClick={(e) => deleteThread(e, t.id)}
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div className="h-full flex max-w-[1400px] mx-auto bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden md:block w-[280px] shrink-0 h-full">
        <SidebarContent />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full p-4 md:p-6">
        <div className="mb-4 md:mb-6 flex items-center gap-3">
          {/* Mobile Sidebar Toggle */}
          <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="md:hidden shrink-0">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-[280px]">
              <SidebarContent />
            </SheetContent>
          </Sheet>

          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Schema-Aware AI Chat</h1>
          </div>
        </div>

        <Card className="flex-1 flex flex-col min-h-0 border-border shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-border bg-muted/30 py-3 hidden md:flex">
            <div className="flex items-center">
              <Database className="w-5 h-5 mr-2 text-primary" />
              <CardTitle className="text-base font-medium">QuerySage Assistant</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col p-0 min-h-0">
            <ScrollArea className="flex-1 p-4 md:p-6" ref={scrollRef}>
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-60">
                  <Database className="w-12 h-12 mb-4 text-primary opacity-80" />
                  <p className="text-center px-4">Hello! I am QuerySage. Ask me about your database schema, indexes, or queries!</p>
                </div>
              ) : (
                <div className="space-y-6 pb-4">
                  {messages.map((msg: ChatMessage, idx: number) => (
                    <div
                      key={idx}
                      className={`flex ${
                        msg.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-5 py-3.5 ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-tr-sm shadow-md"
                            : "bg-muted/40 text-foreground rounded-tl-sm border border-border/50 shadow-sm"
                        }`}
                      >
                        {msg.role === "user" ? (
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        ) : (
                          <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {isLoading && messages[messages.length - 1]?.role === "user" && (
                    <div className="flex justify-start">
                      <div className="bg-muted/40 rounded-2xl rounded-tl-sm px-5 py-4 border border-border/50">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
            
            <div className="p-4 bg-background">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex gap-2 max-w-4xl mx-auto"
              >
                <Input
                  placeholder="E.g., Which tables are missing indexes?"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isLoading}
                  className="flex-1 rounded-full px-5 h-12 border-border shadow-sm focus-visible:ring-primary/50 text-base"
                />
                <Button 
                  type="submit" 
                  disabled={!input.trim() || isLoading}
                  size="icon"
                  className="rounded-full shadow-sm shrink-0 h-12 w-12"
                >
                  <Send className="w-5 h-5" />
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
