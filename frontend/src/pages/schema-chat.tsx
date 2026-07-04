import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, SignInButton, useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Database, Code2, Zap, SearchCode, Loader2, Activity, Network, Play, Clock, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { useGetHistory, useDeleteHistoryEntry, getGetHistoryQueryKey, useGetHistoryEntry } from "@workspace/api-client-react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import ReactDiffViewer from 'react-diff-viewer-continued';
import { ReactFlow, Background, Controls, applyNodeChanges, applyEdgeChanges, type Node, type Edge, type NodeChange, type EdgeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from "sonner";

type ViewState = "dashboard" | "sql-optimizer" | "db-analyzer" | "schema-builder";

export default function SchemaChatPage() {
  const { getToken, isSignedIn } = useAuth();
  const clerk = useClerk();
  const [view, setView] = useState<ViewState>("dashboard");
  
  // Cinematic Intro State
  const [introStep, setIntroStep] = useState(0); 
  const [introText, setIntroText] = useState("");
  const [fadeState, setFadeState] = useState<"in" | "out">("in");

  // SQL Optimizer State
  const [rawSql, setRawSql] = useState("");
  const [optimizedOutput, setOptimizedOutput] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);
  
  // Advanced Context States
  const [dialect, setDialect] = useState("PostgreSQL");
  const [optimizationGoal, setOptimizationGoal] = useState("Max Performance");
  const [schemaContext, setSchemaContext] = useState("");
  const [explainPlan, setExplainPlan] = useState("");
  const [outputViewMode, setOutputViewMode] = useState<"explanation" | "diff">("explanation");
  
  // History State
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: history = [], isLoading: isLoadingHistory, isError, error, refetch } = useGetHistory({ query: { queryKey: getGetHistoryQueryKey(), enabled: !!isSignedIn } });
  const deleteEntry = useDeleteHistoryEntry();

  const handleLoadHistory = (item: any) => {
    setRawSql(item.original_query);
    setOptimizedOutput(item.optimized_query || "");
    setDialect(item.db_type || "PostgreSQL");
    setIsHistoryOpen(false);
    toast.success("History loaded successfully");
  };

  const handleDeleteHistory = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteEntry.mutate({ id }, {
      onSuccess: () => {
        toast.success("Entry deleted");
        queryClient.invalidateQueries({ queryKey: getGetHistoryQueryKey() });
      }
    });
  };

  const extractSqlBlock = (markdown: string) => {
    const match = markdown.match(/```sql\n([\s\S]*?)```/);
    return match ? match[1].trim() : "";
  };

  // DB Analyzer State
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [dbUri, setDbUri] = useState("");
  const [telemetryData, setTelemetryData] = useState<any>(null);
  
  // Schema Builder State
  const [schemaDDL, setSchemaDDL] = useState("");
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const onNodesChange = (changes: NodeChange<Node>[]) => setNodes((nds) => applyNodeChanges(changes, nds));
  const onEdgesChange = (changes: EdgeChange<Edge>[]) => setEdges((eds) => applyEdgeChanges(changes, eds));

  const generateDiagram = () => {
    if (!schemaDDL.trim()) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const tableRegex = /CREATE TABLE\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\);/gi;
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    let match;
    let yOffset = 0;
    let xOffset = 0;
    while ((match = tableRegex.exec(schemaDDL)) !== null) {
      const tableName = match[1];
      const columnsBlock = match[2];
      const columns = columnsBlock.split(',').map(c => c.trim().split(' ')[0]).filter(c => c && !c.toLowerCase().includes('foreign') && !c.toLowerCase().includes('primary') && !c.toLowerCase().includes('constraint'));
      newNodes.push({
        id: tableName,
        position: { x: xOffset, y: yOffset },
        data: { 
          label: (
            <div className="flex flex-col text-left">
              <div className="font-bold text-xs bg-indigo-500/20 text-indigo-200 px-2 py-1 rounded-t-md border-b border-indigo-500/30">
                {tableName}
              </div>
              <div className="bg-[#111113] p-2 rounded-b-md text-[10px] text-zinc-400 font-mono">
                {columns.map((c, i) => <div key={i}>{c}</div>)}
              </div>
            </div>
          ) 
        },
        style: { background: 'transparent', border: '1px solid rgba(99, 102, 241, 0.2)', borderRadius: '6px', padding: 0, width: 150 }
      });
      const fkRegex = /FOREIGN KEY\s*\([^\)]+\)\s*REFERENCES\s+([a-zA-Z0-9_]+)/gi;
      let fkMatch;
      while ((fkMatch = fkRegex.exec(columnsBlock)) !== null) {
        newEdges.push({
          id: `e-${tableName}-${fkMatch[1]}`,
          source: tableName,
          target: fkMatch[1],
          animated: true,
          style: { stroke: '#8b5cf6' }
        });
      }
      xOffset += 200;
      if (xOffset > 600) {
        xOffset = 0;
        yOffset += 150;
      }
    }
    setNodes(newNodes);
    setEdges(newEdges);
  };
  
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view") as ViewState | null;
    const historyId = params.get("history_id");
    
    if (viewParam && (viewParam === "sql-optimizer" || viewParam === "db-analyzer" || viewParam === "schema-builder")) {
      if (view !== viewParam) {
        setView(viewParam);
      }
      setIntroStep(2);
      return;
    }

    // Only play intro when entering the dashboard
    if (view !== "dashboard") return;
    
    setIntroStep(1);
    const sequence = async () => {
      await new Promise(r => setTimeout(r, 500));
      
      setIntroText("Hello. I am QuerySage.");
      setFadeState("in");
      await new Promise(r => setTimeout(r, 2000));
      
      setFadeState("out");
      await new Promise(r => setTimeout(r, 800));
      
      setIntroText("Please select an option to begin.");
      setFadeState("in");
      await new Promise(r => setTimeout(r, 1500));
      
      setIntroStep(2); // Unlocks the dashboard cards to fade in
    };
    sequence();
  }, [view]);

  // Sync view state to URL to support refreshing
  useEffect(() => {
    if (view !== "dashboard") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("view") !== view) {
        window.history.pushState({}, document.title, `${window.location.pathname}?view=${view}`);
      }
    } else {
      const params = new URLSearchParams(window.location.search);
      if (params.has("view")) {
        window.history.pushState({}, document.title, window.location.pathname);
      }
    }
  }, [view]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const historyId = params.get("history_id");
    
    if (historyId && history.length > 0) {
      const item = history.find((h: any) => h.id === parseInt(historyId));
      if (item) {
        // Prevent continuous reloading by clearing it from URL
        const newParams = new URLSearchParams(window.location.search);
        newParams.delete("history_id");
        window.history.replaceState({}, document.title, `${window.location.pathname}?${newParams.toString()}`);
        
        setRawSql(item.original_query);
        setOptimizedOutput(item.optimized_query || "");
        setDialect(item.db_type || "PostgreSQL");
        toast.success("History loaded successfully");
      }
    }
  }, [history]);

  useEffect(() => {
    if (isHistoryOpen) {
      refetch();
    }
  }, [isHistoryOpen, refetch]);

  const handleOptimize = async (sqlToOptimize: string) => {
    if (!isSignedIn) {
      toast.error("Please sign in to run optimizations.");
      return;
    }
    if (!sqlToOptimize.trim()) return;
    
    setIsOptimizing(true);
    setOptimizedOutput("");

    try {
      const token = await getToken();
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const apiUrl = `${baseUrl}/api/schema-chat`;
      
      let fullMessage = `Please optimize the following SQL query for the ${dialect} database.\nGoal: ${optimizationGoal}.\n\nRaw Query:\n\`\`\`sql\n${sqlToOptimize}\n\`\`\``;
      if (schemaContext.trim()) {
        fullMessage += `\n\nSchema Context (DDL):\n\`\`\`sql\n${schemaContext}\n\`\`\``;
      }
      if (explainPlan.trim()) {
        fullMessage += `\n\nExecution Plan (EXPLAIN ANALYZE):\n\`\`\`\n${explainPlan}\n\`\`\``;
      }
      
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: fullMessage,
          chat_history: [],
          timezone_offset: new Date().getTimezoneOffset(),
        }),
      });

      if (!response.ok) throw new Error("Backend connection failed.");

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
                setOptimizedOutput(prev => prev + `\n\n⚠️ **Error:** ${errorMsg}`);
              } catch (e) {}
              continue;
            }

            try {
              const data = JSON.parse(dataStr);
              if (typeof data === "string" && currentEvent !== "error") {
                setOptimizedOutput(prev => prev + data);
              }
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      console.error(err);
      setOptimizedOutput("⚠️ **Backend Connection Failed:**\n\nCould not connect to the Python backend. Ensure that your backend is running locally or deployed, and `VITE_API_URL` is configured.");
    } finally {
      setIsOptimizing(false);
    }
  };

  const connectDbTelemetry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSignedIn) {
      toast.error("Please authenticate first.");
      return;
    }
    if (!dbUri.trim()) return;

    let host = "", port = 5432, database = "", username = "", password = "";
    try {
      const url = new URL(dbUri);
      host = url.hostname;
      port = parseInt(url.port) || 5432;
      database = url.pathname.replace("/", "");
      username = url.username;
      password = url.password;
    } catch (err) {
      toast.error("Invalid database URI format.");
      return;
    }

    setIsConnecting(true);
    try {
      const token = await getToken();
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const apiUrl = `${baseUrl}/api/monitor/telemetry`;
      
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          db_type: "postgresql",
          host, port, database, username, password
        }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch telemetry.");
      
      setTelemetryData(data);
      setIsConnected(true);
      toast.success("Connected to database securely!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Could not connect to the database.");
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="h-full w-full bg-[#050505] relative overflow-hidden flex flex-col font-sans text-zinc-50">
      
      {/* Subtle Background Elements */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-900/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-violet-900/10 blur-[120px] rounded-full"></div>
      </div>

      {/* Header (Full Width, Top Corners) */}
      <div className="relative z-20 w-full px-6 py-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
           {view !== "dashboard" && (
              <Button variant="ghost" size="icon" onClick={() => setView("dashboard")} className="text-zinc-400 hover:text-white mr-2">
                <ArrowLeft className="w-5 h-5" />
              </Button>
           )}
           <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                 <Database className="w-5 h-5 text-indigo-400" />
                 QuerySage
              </h1>
              <p className="text-xs text-zinc-400 mt-1">Enterprise Database Intelligence Toolkit</p>
           </div>
        </div>
        
        {!isSignedIn && (
           <SignInButton mode="modal" forceRedirectUrl="/">
              <Button className="bg-white hover:bg-zinc-200 text-black font-medium px-6 py-2 h-9 rounded-lg text-sm">
                Authenticate
              </Button>
           </SignInButton>
        )}
      </div>

      <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex-1 flex flex-col min-h-0 pb-6">

        {/* --- VIEW: DASHBOARD --- */}
        {view === "dashboard" && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-0">
            
            {/* Fluid Neural Core Orb (Background Element) */}
            <div className={`relative w-40 h-40 sm:w-56 sm:h-56 mb-12 flex items-center justify-center transition-all duration-1000 transform ${introStep >= 1 ? 'scale-100 opacity-100' : 'scale-75 opacity-0'}`}>
              <div className="absolute inset-0 rounded-full blur-2xl opacity-50 bg-indigo-500"></div>
              <div className="absolute w-[120%] h-[120%] -top-[10%] -left-[10%] rounded-full mix-blend-screen filter blur-[24px] animate-blob bg-violet-500/80"></div>
              <div className="absolute w-[110%] h-[110%] top-[0%] right-[0%] rounded-full mix-blend-screen filter blur-[20px] animate-blob animation-delay-2000 bg-cyan-400/80"></div>
              <div className="absolute w-[100%] h-[100%] -bottom-[10%] left-[10%] rounded-full mix-blend-screen filter blur-[20px] animate-blob animation-delay-4000 bg-fuchsia-500/80"></div>
              <div className="absolute inset-2 rounded-full border border-white/5 backdrop-blur-[2px] shadow-[inset_0_0_30px_rgba(255,255,255,0.05)]"></div>
            </div>

            {/* Cinematic Fading Text */}
            <div className={`min-h-[60px] flex flex-col items-center justify-center text-center px-4 transition-all duration-700 ${introStep === 2 ? 'mb-8' : 'mb-0'}`}>
              <h1 className={`text-2xl md:text-3xl font-light tracking-wide leading-relaxed transition-all duration-700 ease-in-out whitespace-pre-wrap ${fadeState === 'in' ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-4'} text-zinc-100`}>
                {introText}
              </h1>
            </div>

            {/* Dashboard Tool Cards (Fade in after sequence) */}
            {introStep >= 2 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl animate-in fade-in slide-in-from-bottom-8 duration-1000 mt-4 card-3d-wrapper">
                
                <Card 
                  className="card-3d bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl hover:border-indigo-500/50 hover:bg-zinc-900/80 cursor-pointer group" 
                  onClick={() => {
                    if (!isSignedIn) clerk.openSignIn({ forceRedirectUrl: `${window.location.pathname}?view=sql-optimizer` });
                    else setView("sql-optimizer");
                  }}
                >
                  <CardHeader className="p-8">
                    <div className="w-16 h-16 bg-indigo-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-indigo-500/20 group-hover:scale-110 transition-all duration-300 group-hover:shadow-[0_0_30px_rgba(99,102,241,0.3)]">
                      <Code2 className="w-8 h-8 text-indigo-400 group-hover:animate-pulse" />
                    </div>
                    <CardTitle className="text-xl text-zinc-100 font-bold tracking-wide group-hover:text-indigo-300 transition-colors">SQL Optimizer</CardTitle>
                    <CardDescription className="text-zinc-400 text-sm leading-relaxed mt-4 group-hover:text-zinc-300 transition-colors">Paste raw SQL queries to rewrite them for maximum performance.</CardDescription>
                  </CardHeader>
                </Card>

                <Card 
                  className="card-3d bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl hover:border-pink-500/50 hover:bg-zinc-900/80 cursor-pointer group" 
                  onClick={() => {
                    if (!isSignedIn) clerk.openSignIn({ forceRedirectUrl: `${window.location.pathname}?view=schema-builder` });
                    else setView("schema-builder");
                  }}
                >
                  <CardHeader className="p-8">
                    <div className="w-16 h-16 bg-pink-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-pink-500/20 group-hover:scale-110 transition-all duration-300 group-hover:shadow-[0_0_30px_rgba(236,72,153,0.3)]">
                      <Network className="w-8 h-8 text-pink-400 group-hover:animate-pulse" />
                    </div>
                    <CardTitle className="text-xl text-zinc-100 font-bold tracking-wide group-hover:text-pink-300 transition-colors">Schema Architect</CardTitle>
                    <CardDescription className="text-zinc-400 text-sm leading-relaxed mt-4 group-hover:text-zinc-300 transition-colors">Design and auto-generate database schemas using an interactive ER diagram.</CardDescription>
                  </CardHeader>
                </Card>

                <Card 
                  className="card-3d bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl hover:border-violet-500/50 hover:bg-zinc-900/80 cursor-pointer group" 
                  onClick={() => {
                    if (!isSignedIn) clerk.openSignIn({ forceRedirectUrl: `${window.location.pathname}?view=db-analyzer` });
                    else setView("db-analyzer");
                  }}
                >
                  <CardHeader className="p-8">
                    <div className="w-16 h-16 bg-violet-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-violet-500/20 group-hover:scale-110 transition-all duration-300 group-hover:shadow-[0_0_30px_rgba(139,92,246,0.3)]">
                      <SearchCode className="w-8 h-8 text-violet-400 group-hover:animate-pulse" />
                    </div>
                    <CardTitle className="text-xl text-zinc-100 font-bold tracking-wide group-hover:text-violet-300 transition-colors">DB Analyzer</CardTitle>
                    <CardDescription className="text-zinc-400 text-sm leading-relaxed mt-4 group-hover:text-zinc-300 transition-colors">Fetch slow-running queries automatically and analyze active bottlenecks.</CardDescription>
                  </CardHeader>
                </Card>

              </div>
            )}
          </div>
        )}

        {/* --- VIEW: SQL OPTIMIZER --- */}
        {view === "sql-optimizer" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-right-8 duration-500 flex-1 min-h-0">
            
            {/* Left Pane: Input */}
            <Card className="bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl flex flex-col shadow-xl overflow-hidden h-full min-h-0">
               <CardHeader className="border-b border-zinc-800/50 py-3 px-4 bg-black/20 shrink-0 flex flex-row items-center justify-between">
                 <CardTitle className="text-base text-zinc-100 flex items-center gap-2">
                   <Code2 className="w-5 h-5 text-indigo-400" /> Optimizer Context
                 </CardTitle>
                 <div className="flex gap-2">
                   <Sheet open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
                     <SheetTrigger asChild>
                       <Button variant="outline" size="sm" className="h-8 bg-black/40 border-zinc-700 text-xs text-zinc-300 hover:text-white">
                         <Clock className="w-3.5 h-3.5 mr-2" />
                         History
                       </Button>
                     </SheetTrigger>
                     <SheetContent className="w-[400px] sm:w-[540px] bg-[#0a0a0c]/95 border-l border-zinc-800 backdrop-blur-xl overflow-y-auto custom-scrollbar">
                       <SheetHeader className="mb-6">
                         <SheetTitle className="text-xl font-semibold text-zinc-100 flex items-center gap-2">
                           <Clock className="w-5 h-5 text-indigo-400" />
                           Optimization History
                         </SheetTitle>
                         <SheetDescription className="text-zinc-400">
                           View and load your previous SQL optimizations.
                         </SheetDescription>
                       </SheetHeader>

                       <div className="flex flex-col gap-4">
                         {isLoadingHistory ? (
                           <div className="flex justify-center items-center py-10">
                             <Loader2 className="h-6 w-6 text-indigo-400 animate-spin" />
                           </div>
                         ) : isError ? (
                           <div className="text-center py-10 text-red-500 flex flex-col items-center gap-2">
                             <span>Error loading history.</span>
                             <span className="text-xs opacity-70">{(error as any)?.message || 'Unknown error'}</span>
                             <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
                           </div>
                         ) : history.length === 0 ? (
                           <div className="text-center py-10 text-zinc-500 flex flex-col items-center gap-2">
                             No history found.
                             {!isSignedIn && <span className="text-xs">Please sign in.</span>}
                             <Button variant="outline" size="sm" onClick={() => refetch()}>Refresh</Button>
                           </div>
                         ) : (
                           history.map((item: any) => (
                             <Card key={item.id} className="bg-[#111113] border-zinc-800 hover:border-indigo-500/50 transition-colors group">
                               <CardContent className="p-4">
                                 <div className="flex justify-between items-start mb-3">
                                   <div className="flex items-center gap-2">
                                     <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-300">
                                       {item.db_type || "PostgreSQL"}
                                     </span>
                                     <span className="text-xs text-zinc-500">
                                       {format(new Date(item.created_at), "MMM d, yyyy h:mm a")}
                                     </span>
                                   </div>
                                   <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                     <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-white hover:bg-indigo-500/20" onClick={() => handleLoadHistory(item)}>
                                       <Database className="h-3.5 w-3.5" />
                                     </Button>
                                     <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-red-400 hover:bg-red-500/10" onClick={(e) => handleDeleteHistory(e, item.id)}>
                                       <Trash2 className="h-3.5 w-3.5" />
                                     </Button>
                                   </div>
                                 </div>
                                 <div className="bg-black/50 p-3 rounded-md border border-zinc-800/50 overflow-hidden">
                                   <p className="text-xs text-zinc-300 font-mono line-clamp-3 whitespace-pre-wrap">
                                     {item.original_query}
                                   </p>
                                 </div>
                               </CardContent>
                             </Card>
                           ))
                         )}
                       </div>
                     </SheetContent>
                   </Sheet>

                   <Select value={dialect} onValueChange={setDialect}>
                     <SelectTrigger className="w-[120px] h-8 bg-black/40 border-zinc-700 text-xs">
                       <SelectValue placeholder="Dialect" />
                     </SelectTrigger>
                     <SelectContent>
                       <SelectItem value="PostgreSQL">PostgreSQL</SelectItem>
                       <SelectItem value="MySQL">MySQL</SelectItem>
                       <SelectItem value="SQL Server">SQL Server</SelectItem>
                       <SelectItem value="Oracle">Oracle</SelectItem>
                       <SelectItem value="SQLite">SQLite</SelectItem>
                     </SelectContent>
                   </Select>
                   
                   <Select value={optimizationGoal} onValueChange={setOptimizationGoal}>
                     <SelectTrigger className="w-[140px] h-8 bg-black/40 border-zinc-700 text-xs">
                       <SelectValue placeholder="Goal" />
                     </SelectTrigger>
                     <SelectContent>
                       <SelectItem value="Max Performance">Max Performance</SelectItem>
                       <SelectItem value="Low CPU/Memory">Low CPU/Memory</SelectItem>
                       <SelectItem value="Format & Lint Only">Format & Lint Only</SelectItem>
                     </SelectContent>
                   </Select>
                 </div>
               </CardHeader>
               <CardContent className="p-0 flex-1 flex flex-col min-h-0">
                  <Tabs defaultValue="query" className="flex-1 flex flex-col min-h-0 rounded-none w-full">
                     <TabsList className="bg-black/30 border-b border-zinc-800/50 rounded-none justify-start h-10 px-2 w-full shrink-0">
                        <TabsTrigger value="query" className="text-xs data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-300 rounded-sm">Raw Query</TabsTrigger>
                        <TabsTrigger value="schema" className="text-xs data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-300 rounded-sm">Schema (DDL)</TabsTrigger>
                        <TabsTrigger value="explain" className="text-xs data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-300 rounded-sm">Execution Plan</TabsTrigger>
                     </TabsList>
                     
                     <TabsContent value="query" className="flex-1 min-h-0 m-0 border-0 p-0 flex flex-col w-full h-full data-[state=active]:flex">
                        <Textarea 
                           value={rawSql}
                           onChange={(e) => setRawSql(e.target.value)}
                           placeholder="Paste your slow SQL query here..."
                           className="flex-1 w-full h-full resize-none bg-transparent border-0 focus-visible:ring-0 text-zinc-200 font-mono text-sm p-4 rounded-none min-h-0"
                        />
                     </TabsContent>
                     
                     <TabsContent value="schema" className="flex-1 min-h-0 m-0 border-0 p-0 flex flex-col w-full h-full data-[state=active]:flex">
                        <Textarea 
                           value={schemaContext}
                           onChange={(e) => setSchemaContext(e.target.value)}
                           placeholder="Paste table definitions (CREATE TABLE...) to help AI optimize indexes and joins..."
                           className="flex-1 w-full h-full resize-none bg-transparent border-0 focus-visible:ring-0 text-zinc-400 font-mono text-sm p-4 rounded-none min-h-0"
                        />
                     </TabsContent>

                     <TabsContent value="explain" className="flex-1 min-h-0 m-0 border-0 p-0 flex flex-col w-full h-full data-[state=active]:flex">
                        <Textarea 
                           value={explainPlan}
                           onChange={(e) => setExplainPlan(e.target.value)}
                           placeholder="Paste the output of EXPLAIN ANALYZE for this query..."
                           className="flex-1 w-full h-full resize-none bg-transparent border-0 focus-visible:ring-0 text-zinc-400 font-mono text-sm p-4 rounded-none min-h-0"
                        />
                     </TabsContent>
                  </Tabs>

                  <div className="p-4 border-t border-zinc-800/50 bg-black/20 shrink-0">
                     <Button 
                       onClick={() => handleOptimize(rawSql)} 
                       disabled={isOptimizing || !rawSql.trim()}
                       className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                     >
                       {isOptimizing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Optimizing...</> : <><Zap className="w-4 h-4 mr-2" /> Run AI Optimization</>}
                     </Button>
                  </div>
               </CardContent>
            </Card>

            {/* Right Pane: Output */}
            <Card className="bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl flex flex-col shadow-xl overflow-hidden h-full min-h-0">
               <CardHeader className="border-b border-zinc-800/50 py-3 px-4 bg-black/20 shrink-0 flex flex-row items-center justify-between">
                 <CardTitle className="text-base text-zinc-100 flex items-center gap-2">
                   <Zap className="w-5 h-5 text-indigo-400" /> AI Optimization Plan
                 </CardTitle>
                 {optimizedOutput && (
                    <div className="flex bg-black/40 rounded-lg p-1 border border-zinc-800">
                       <button onClick={() => setOutputViewMode("explanation")} className={`px-3 py-1 text-xs rounded-md transition-colors ${outputViewMode === 'explanation' ? 'bg-indigo-500/20 text-indigo-300' : 'text-zinc-500 hover:text-zinc-300'}`}>Explanation</button>
                       <button onClick={() => setOutputViewMode("diff")} className={`px-3 py-1 text-xs rounded-md transition-colors ${outputViewMode === 'diff' ? 'bg-indigo-500/20 text-indigo-300' : 'text-zinc-500 hover:text-zinc-300'}`}>Code Diff</button>
                    </div>
                 )}
               </CardHeader>
               <CardContent className="p-0 overflow-hidden flex-1 flex flex-col min-h-0 bg-[#0a0a0c]/50">
                  {!optimizedOutput && !isOptimizing ? (
                     <div className="h-full flex items-center justify-center text-zinc-500 text-sm p-6">
                       Run optimization to see the results here.
                     </div>
                  ) : outputViewMode === "explanation" ? (
                     <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-p:leading-loose prose-pre:bg-[#050505] prose-pre:border prose-pre:border-zinc-800/80 prose-pre:rounded-xl font-light tracking-wide text-zinc-200 overflow-y-auto custom-scrollbar p-6">
                        <ReactMarkdown>{optimizedOutput}</ReactMarkdown>
                     </div>
                  ) : (
                     <div className="h-full overflow-auto text-sm custom-scrollbar bg-[#0a0a0c] p-4 flex flex-col gap-6">
                        <div className="flex flex-col border border-zinc-800/80 rounded-lg overflow-hidden shadow-sm">
                           <div className="bg-red-950/20 text-red-400 px-4 py-2 text-xs font-semibold tracking-wider border-b border-zinc-800/80 uppercase">Original Query (Old)</div>
                           <pre className="p-4 m-0 bg-[#050505] text-zinc-300 font-mono text-xs md:text-sm whitespace-pre-wrap overflow-x-auto leading-relaxed">
                              {rawSql || "-- No original query provided."}
                           </pre>
                        </div>
                        <div className="flex flex-col border border-zinc-800/80 rounded-lg overflow-hidden shadow-sm">
                           <div className="bg-green-950/20 text-green-400 px-4 py-2 text-xs font-semibold tracking-wider border-b border-zinc-800/80 uppercase">Optimized Query (New)</div>
                           <pre className="p-4 m-0 bg-[#050505] text-zinc-300 font-mono text-xs md:text-sm whitespace-pre-wrap overflow-x-auto leading-relaxed">
                              {extractSqlBlock(optimizedOutput) || "-- AI hasn't generated valid SQL yet.\n-- See explanation for details."}
                           </pre>
                        </div>
                     </div>
                  )}
               </CardContent>
            </Card>

          </div>
        )}

        {/* --- VIEW: SCHEMA BUILDER --- */}
        {view === "schema-builder" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-right-8 duration-500 flex-1 min-h-0">
            
            {/* Left Pane: DDL Input */}
            <Card className="lg:col-span-1 bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl flex flex-col shadow-xl overflow-hidden h-full min-h-0">
               <CardHeader className="border-b border-zinc-800/50 pb-4 bg-black/20 shrink-0">
                 <CardTitle className="text-lg text-zinc-100 flex items-center gap-2">
                   <Code2 className="w-5 h-5 text-pink-400" /> Schema Definitions (DDL)
                 </CardTitle>
               </CardHeader>
               <CardContent className="p-0 flex-1 flex flex-col min-h-0">
                  <Textarea 
                     value={schemaDDL}
                     onChange={(e) => setSchemaDDL(e.target.value)}
                     placeholder={"CREATE TABLE users (\n  id INT PRIMARY KEY,\n  name VARCHAR\n);\n\nCREATE TABLE orders (\n  id INT PRIMARY KEY,\n  user_id INT,\n  FOREIGN KEY (user_id) REFERENCES users\n);"}
                     className="flex-1 w-full h-full resize-none bg-transparent border-0 focus-visible:ring-0 text-zinc-200 font-mono text-sm p-4 rounded-none min-h-0"
                  />
                  <div className="p-4 border-t border-zinc-800/50 bg-black/20 shrink-0">
                     <Button 
                       onClick={generateDiagram} 
                       disabled={!schemaDDL.trim()}
                       className="w-full bg-pink-600 hover:bg-pink-500 text-white font-medium"
                     >
                       <Play className="w-4 h-4 mr-2" /> Visualize ER Diagram
                     </Button>
                  </div>
               </CardContent>
            </Card>

            {/* Right Pane: ER Diagram */}
            <Card className="lg:col-span-2 bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl flex flex-col shadow-xl overflow-hidden h-full min-h-0">
               <CardHeader className="border-b border-zinc-800/50 pb-4 bg-black/20 shrink-0">
                 <CardTitle className="text-lg text-zinc-100 flex items-center gap-2">
                   <Network className="w-5 h-5 text-pink-400" /> Interactive ER Diagram
                 </CardTitle>
               </CardHeader>
               <CardContent className="p-0 flex-1 min-h-0 bg-[#0a0a0c]">
                 <div className="w-full h-full">
                   <ReactFlow
                     nodes={nodes}
                     edges={edges}
                     onNodesChange={onNodesChange}
                     onEdgesChange={onEdgesChange}
                     fitView
                     proOptions={{ hideAttribution: true }}
                     colorMode="dark"
                   >
                     <Background color="#333" gap={16} />
                     <Controls />
                   </ReactFlow>
                 </div>
               </CardContent>
            </Card>

          </div>
        )}

        {/* --- VIEW: DB ANALYZER --- */}
        {view === "db-analyzer" && (
           <div className="animate-in fade-in slide-in-from-right-8 duration-500 flex-1 flex flex-col min-h-0 overflow-hidden">
              
              {!isConnected ? (
                 <Card className="max-w-md mx-auto mt-12 bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl shadow-xl">
                    <CardHeader>
                       <CardTitle className="text-xl">Connect Database</CardTitle>
                       <CardDescription>Enter credentials to fetch live database telemetry securely.</CardDescription>
                    </CardHeader>
                    <CardContent>
                       <form onSubmit={connectDbTelemetry} className="space-y-4">
                          <div className="space-y-2">
                             <Label className="text-zinc-400">Database Connection URI</Label>
                             <Input value={dbUri} onChange={(e) => setDbUri(e.target.value)} placeholder="postgresql://user:pass@host:5432/db" required className="bg-black/50 border-zinc-800 text-zinc-200 focus-visible:ring-indigo-500 font-mono text-xs" />
                          </div>
                          <Button type="submit" disabled={isConnecting || !dbUri.trim()} className="w-full bg-violet-600 hover:bg-violet-500 text-white mt-4">
                             {isConnecting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Fetching Telemetry...</> : "Connect securely"}
                          </Button>
                       </form>
                    </CardContent>
                 </Card>
              ) : (
                 <div className="flex flex-col gap-6 w-full h-full pb-6 custom-scrollbar overflow-y-auto">
                    {/* Health Metrics Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
                       <Card className="bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl">
                          <CardHeader className="py-4">
                             <CardTitle className="text-sm text-zinc-400">Active Connections</CardTitle>
                             <div className="text-3xl font-bold text-violet-400">{telemetryData?.active_connections || 0}</div>
                          </CardHeader>
                       </Card>
                       <Card className="bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl">
                          <CardHeader className="py-4">
                             <CardTitle className="text-sm text-zinc-400">Cache Hit Ratio</CardTitle>
                             <div className="text-3xl font-bold text-emerald-400">{telemetryData?.cache_hit_ratio?.toFixed(2) || 0}%</div>
                          </CardHeader>
                       </Card>
                    </div>

                    {/* Missing Indexes */}
                    {telemetryData?.missing_indexes?.length > 0 && (
                       <Card className="bg-[#111113]/80 border-rose-900/50 backdrop-blur-xl shrink-0">
                          <CardHeader className="py-4 border-b border-rose-900/30 bg-rose-950/20">
                             <CardTitle className="text-sm text-rose-400 flex items-center gap-2">⚠️ Missing Indexes Detected</CardTitle>
                          </CardHeader>
                          <CardContent className="p-4">
                             <div className="flex flex-wrap gap-2">
                                {telemetryData.missing_indexes.map((idx: any, i: number) => (
                                   <div key={i} className="bg-rose-950/40 border border-rose-900/50 px-3 py-1 rounded-md text-xs text-rose-200">
                                      Table: <span className="font-mono">{idx.table_name}</span> (Seq Scans: {idx.seq_scan})
                                   </div>
                                ))}
                             </div>
                          </CardContent>
                       </Card>
                    )}

                    {/* Slow Queries */}
                    <Card className="bg-[#111113]/80 border-zinc-800/50 backdrop-blur-xl shadow-xl flex-1 flex flex-col min-h-[400px]">
                       <CardHeader className="bg-black/20 border-b border-zinc-800/50 shrink-0 py-4">
                          <CardTitle className="text-base flex items-center gap-2">
                             <Activity className="w-5 h-5 text-red-400" /> Top Slow Queries
                          </CardTitle>
                       </CardHeader>
                       <CardContent className="p-0 flex-1 overflow-x-auto">
                          <Table>
                             <TableHeader className="bg-black/40">
                                <TableRow className="hover:bg-transparent border-zinc-800/50">
                                   <TableHead className="text-zinc-400">Raw Query</TableHead>
                                   <TableHead className="w-[120px] text-zinc-400">Avg (ms)</TableHead>
                                   <TableHead className="w-[80px] text-zinc-400">Calls</TableHead>
                                   <TableHead className="w-[100px] text-right text-zinc-400">Action</TableHead>
                                </TableRow>
                             </TableHeader>
                             <TableBody>
                                {telemetryData?.queries?.length > 0 ? telemetryData.queries.map((q: any, i: number) => (
                                   <TableRow key={i} className="border-zinc-800/50 hover:bg-zinc-800/30">
                                      <TableCell className="font-mono text-xs text-zinc-300 max-w-md truncate py-3">{q.query}</TableCell>
                                      <TableCell className="text-red-400 font-medium py-3">{q.execution_time_ms?.toFixed(2)}</TableCell>
                                      <TableCell className="text-zinc-300 py-3">{q.calls}</TableCell>
                                      <TableCell className="text-right py-3">
                                         <Button size="sm" variant="outline" className="border-indigo-500/50 hover:bg-indigo-500/20 text-indigo-300 h-7 px-3 text-xs" onClick={() => {
                                            setRawSql(q.query);
                                            setView("sql-optimizer");
                                            setTimeout(() => handleOptimize(q.query), 300);
                                         }}>
                                            Optimize
                                         </Button>
                                      </TableCell>
                                   </TableRow>
                                )) : (
                                   <TableRow>
                                      <TableCell colSpan={4} className="text-center py-8 text-zinc-500">No slow queries found. Your database is lightning fast! ⚡</TableCell>
                                   </TableRow>
                                )}
                             </TableBody>
                          </Table>
                       </CardContent>
                    </Card>
                 </div>
              )}
           </div>
        )}

      </div>
    </div>
  );
}
