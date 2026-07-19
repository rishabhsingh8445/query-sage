import { useState, useEffect, useRef } from "react";
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
import { ArrowLeft, Database, DatabaseZap, Code2, Zap, SearchCode, Loader2, Activity, Network, Play, Clock, Trash2, Bot, Brain, Cpu, Shield, FileCheck, CheckCircle2, CircleDot, Calculator, ShieldAlert, Sparkles } from "lucide-react";
import { IndexEstimator } from "@/components/IndexEstimator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { useGetHistory, useDeleteHistoryEntry, getGetHistoryQueryKey, useGetHistoryEntry } from "@workspace/api-client-react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import ReactDiffViewer from 'react-diff-viewer-continued';
import { ReactFlow, Background, Controls, applyNodeChanges, applyEdgeChanges, type Node, type Edge, type NodeChange, type EdgeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from "sonner";
import { SchemaErd } from "@/components/SchemaErd";
import { ExplainGraph } from "@/components/ExplainGraph";
import { AgentSwarm } from "@/components/AgentSwarm";
import { Badge } from "@/components/ui/badge";
import { parseRawExplainToTree } from "@/lib/explainParser";
import { parseSqlSchemaToNodes } from "@/utils/sqlParser";

type ViewState = "dashboard" | "sql-optimizer" | "db-analyzer" | "schema-builder";

export default function SchemaChatPage() {
  const { getToken, userId } = useAuth();
  const isSignedIn = !!userId;
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
  const [optimizationResult, setOptimizationResult] = useState<any>(null);
  const [traces, setTraces] = useState<string[]>([]);
  const [streamStatus, setStreamStatus] = useState("");

  const [isEstimating, setIsEstimating] = useState(false);
  const [estimateResult, setEstimateResult] = useState<{ cost: number, rows: number, risk_level: string, message: string } | null>(null);

  // DB Connection Config State
  interface DbConnectionConfig {
    db_type: string;
    host: string;
    port: number;
    database: string;
    username: string;
    password?: string;
  }
  const [dbConfig, setDbConfig] = useState<DbConnectionConfig | null>(null);

  // Agent Activity State
  type AgentStatus = "idle" | "working" | "done";
  interface AgentState {
    id: string;
    name: string;
    description: string;
    icon: React.ReactNode;
    status: AgentStatus;
    color: string;
  }
  const [agents, setAgents] = useState<AgentState[]>([
    { id: "parser", name: "Query Parser", description: "Analyzing SQL complexity & syntax", icon: <SearchCode className="w-5 h-5" />, status: "idle", color: "indigo" },
    { id: "schema", name: "Schema Analyzer", description: "Evaluating table relationships & indexes", icon: <Database className="w-5 h-5" />, status: "idle", color: "cyan" },
    { id: "engine", name: "Deep Optimizer", description: "Generating complex performance improvements", icon: <Brain className="w-5 h-5" />, status: "idle", color: "violet" },
    { id: "advisor", name: "Index Advisor", description: "Recommending index strategies", icon: <Cpu className="w-5 h-5" />, status: "idle", color: "amber" },
    { id: "compiler", name: "Result Compiler", description: "Preparing optimized output", icon: <FileCheck className="w-5 h-5" />, status: "idle", color: "emerald" },
  ]);

  const activateAgent = (agentId: string) => {
    setAgents(prev => prev.map(a => {
      if (a.id === agentId) return { ...a, status: "working" };
      if (a.status === "working") return { ...a, status: "done" };
      return a;
    }));
  };
  const completeAgent = (agentId: string) => {
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: "done" } : a));
  };
  const resetAgents = () => {
    setAgents(prev => prev.map(a => ({ ...a, status: "idle" })));
  };
  
  // Advanced Context States
  const [dialect, setDialect] = useState("PostgreSQL");
  const [optimizationGoal, setOptimizationGoal] = useState("Max Performance");
  const [schemaContext, setSchemaContext] = useState("");
  const [explainPlan, setExplainPlan] = useState("");
  const [outputViewMode, setOutputViewMode] = useState<"explanation" | "diff" | "visual">("explanation");
  
  // History State
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: history = [], isLoading: isLoadingHistory, isError, error, refetch } = useGetHistory({ query: { queryKey: getGetHistoryQueryKey(), enabled: !!isSignedIn } });
  const deleteEntry = useDeleteHistoryEntry();

  const handleLoadHistory = (item: any) => {
    setRawSql(item.original_query);
    const md = `${item.explanation || ""}\n\n\`\`\`sql\n${item.optimized_query || ""}\n\`\`\``;
    setOptimizedOutput(md);
    setOptimizationResult(item);
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
  const [visualizedSchema, setVisualizedSchema] = useState("");
  const hasPrefilledSchema = useRef(false);
  const [copilotPrompt, setCopilotPrompt] = useState("");
  const [isGeneratingDDL, setIsGeneratingDDL] = useState(false);

  const handleGenerateDDL = async () => {
    if (!copilotPrompt.trim()) return;
    setIsGeneratingDDL(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || ""}/api/schema/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: copilotPrompt, current_schema: schemaDDL })
      });
      if (!response.ok) {
        const d = await response.json().catch(() => ({}));
        throw new Error(d.detail || "Generation failed.");
      }
      const data = await response.json();
      setSchemaDDL(data.ddl);
      setVisualizedSchema(data.ddl);
      setCopilotPrompt("");
      toast.success("DDL Schema generated and visualized successfully!");
      
      try {
        const parsedNodes = parseSqlSchemaToNodes(data.ddl);
        if (parsedNodes.length > 0) {
          saveSchemaToDb(data.ddl, parsedNodes.length);
        }
      } catch (err) {}
    } catch (e: any) {
      toast.error(`DDL Generation failed: ${e.message}`);
    } finally {
      setIsGeneratingDDL(false);
    }
  };

  // Schema History State
  const [isSchemaHistoryOpen, setIsSchemaHistoryOpen] = useState(false);
  const [schemaHistoryList, setSchemaHistoryList] = useState<any[]>([]);

  const fetchSchemaHistory = async () => {
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${baseUrl}/api/schema/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSchemaHistoryList(data);
      }
    } catch (e) {
      console.error("Failed to fetch schema history:", e);
    }
  };

  useEffect(() => {
    if (isSchemaHistoryOpen) {
      fetchSchemaHistory();
    }
  }, [isSchemaHistoryOpen]);

  const saveSchemaToDb = async (ddlText: string, tableCount: number) => {
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      const baseUrl = import.meta.env.VITE_API_URL || "";
      await fetch(`${baseUrl}/api/schema/history`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ ddl: ddlText, table_count: tableCount })
      });
      fetchSchemaHistory();
    } catch (e) {
      console.error("Failed to save schema history:", e);
    }
  };

  const handleLoadSchemaHistory = (item: any) => {
    setSchemaDDL(item.ddl);
    setVisualizedSchema(item.ddl);
    setIsSchemaHistoryOpen(false);
    toast.success("Loaded schema from history successfully!");
  };

  const handleDeleteSchemaHistory = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${baseUrl}/api/schema/history/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success("Schema history entry deleted");
        fetchSchemaHistory();
      }
    } catch (e) {
      console.error("Failed to delete schema history entry:", e);
    }
  };


  useEffect(() => {
    if (view === "schema-builder" && schemaDDL.trim() && !hasPrefilledSchema.current) {
      hasPrefilledSchema.current = true;
      setVisualizedSchema(schemaDDL);
    }
  }, [view]);

  const generateDiagram = () => {
    if (!schemaDDL.trim()) {
      setVisualizedSchema("");
      toast.error("Schema DDL is empty.");
      return;
    }
    try {
      const parsedNodes = parseSqlSchemaToNodes(schemaDDL);
      if (parsedNodes.length === 0) {
        toast.error("No valid CREATE TABLE statements detected. Please verify your SQL syntax (e.g. closing parentheses).");
      } else {
        setVisualizedSchema(schemaDDL);
        saveSchemaToDb(schemaDDL, parsedNodes.length);
        toast.success(`Successfully visualized ${parsedNodes.length} tables!`);
      }
    } catch (e: any) {
      toast.error(`Parsing failed: ${e.message || e}`);
    }
  };
  
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view") as ViewState | null;
    
    if (viewParam && (viewParam === "sql-optimizer" || viewParam === "db-analyzer" || viewParam === "schema-builder")) {
      setView(viewParam);
      setIntroStep(2);
      setIntroText("Please select an option to begin.");
      return;
    }

    // Play intro only on initial load if no specific view is requested
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
  }, []); // Run only on mount

  // Prefill query from session storage if redirected from visual builder/monitor
  useEffect(() => {
    const prefill = sessionStorage.getItem('prefillQuery');
    if (prefill) {
      setRawSql(prefill);
      setView("sql-optimizer");
      setIntroStep(2);
      sessionStorage.removeItem('prefillQuery');
      toast.success("Query prefilled successfully");
    }
  }, []);

  // Sync view state to URL to support refreshing
  useEffect(() => {
    if (view !== "dashboard") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("view") !== view) {
        window.history.pushState({ view }, document.title, `${window.location.pathname}?view=${view}`);
      }
    } else {
      const params = new URLSearchParams(window.location.search);
      if (params.has("view")) {
        window.history.pushState({ view: "dashboard" }, document.title, window.location.pathname);
      }
    }
  }, [view]);

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const params = new URLSearchParams(window.location.search);
      const viewParam = params.get("view") as ViewState | null;
      if (viewParam) {
        setView(viewParam);
        setIntroStep(2);
      } else {
        setView("dashboard");
        setIntroStep(2);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

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
    setTraces([]);
    setStreamStatus("Initializing Swarm Engine...");
    resetAgents();
    
    // Start with parser working
    activateAgent("parser");

    try {
      const token = await getToken();
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const apiUrl = `${baseUrl}/api/langgraph-optimize`;
      
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
          raw_query: sqlToOptimize,
          db_type: dialect,
          db_config: dbConfig,
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
            
            if (currentEvent === "status") {
              try { setStreamStatus(JSON.parse(dataStr)); } catch(e) {}
            }

            if (currentEvent === "trace") {
              try {
                const traceData = JSON.parse(dataStr);
                const step = traceData.step as string;
                setTraces(prev => [...prev, step]);
                if (step.includes("Analyzing Schema")) {
                  activateAgent("schema");
                } else if (step.includes("Generating Optimized SQL")) {
                  activateAgent("engine");
                } else if (step.includes("Evaluating Cost")) {
                  activateAgent("advisor");
                } else if (step.includes("Validating")) {
                  activateAgent("compiler");
                }
              } catch (e) {}
              continue;
            }

            try {
              const data = JSON.parse(dataStr);
              if (currentEvent === "chunk") {
                // If it's a JSON block from the langgraph backend
                if (typeof data === "object" && data.optimized_query) {
                  activateAgent("compiler");
                  setOptimizationResult(data);
                  const explanation = data.explanation || "";
                  const sql = data.optimized_query;
                  const md = `${explanation}\n\n\`\`\`sql\n${sql}\n\`\`\``;
                  setOptimizedOutput(md);
                  completeAgent("compiler");
                } else if (typeof data === "string") {
                  setOptimizedOutput(prev => prev + data);
                }
              } else if (typeof data === "string" && currentEvent !== "error") {
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
      // Make sure any "working" agents are completed
      setAgents(prev => prev.map(a => a.status === "working" ? { ...a, status: "done" } : a));
      setTimeout(() => {
        setIsOptimizing(false);
      }, 500);
      // Refresh history cache so new entry appears in sidebar
      queryClient.invalidateQueries({ queryKey: getGetHistoryQueryKey() });
    }
  };

  const estimateCost = async () => {
    if (!dbConfig) return;
    setIsEstimating(true);
    setEstimateResult(null);
    try {
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const token = await getToken();
      const input = {
        query: rawSql,
        db_config: dbConfig
      };

      const res = await fetch(`${baseUrl}/api/queries/estimate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(input)
      });
      
      if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        throw new Error(err.error || "Failed to estimate cost");
      }
      const data = await res.json();
      setEstimateResult(data);
      toast.success("Cost estimation retrieved");
    } catch (err: any) {
      toast.error(err.message || "Failed to estimate query cost");
    } finally {
      setIsEstimating(false);
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
      setDbConfig({
        db_type: "postgresql",
        host,
        port,
        database,
        username,
        password
      });
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
                 <DatabaseZap className="w-6 h-6 text-primary animate-pulse" />
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
                 <div className="flex items-center gap-2">
                   <Sheet open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
                     <SheetTrigger asChild>
                       <Button variant="outline" size="sm" className="h-8 bg-black/40 border-zinc-700 text-xs text-zinc-300 hover:text-white flex items-center gap-1.5 px-3">
                         <Clock className="w-3.5 h-3.5" />
                         <span>History</span>
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
                     <SelectTrigger className="w-[110px] h-8 bg-black/40 border-zinc-700 text-xs text-zinc-300 focus:ring-0 focus:ring-offset-0">
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
                     <SelectTrigger className="w-[135px] h-8 bg-black/40 border-zinc-700 text-xs text-zinc-300 focus:ring-0 focus:ring-offset-0">
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

                  <div className="p-4 border-t border-zinc-800/50 bg-black/20 shrink-0 space-y-4">
                     <div className="flex gap-4">
                        <Button 
                          onClick={() => handleOptimize(rawSql)} 
                          disabled={isOptimizing || !rawSql.trim()}
                          className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                        >
                          {isOptimizing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Optimizing...</> : <><Zap className="w-4 h-4 mr-2" /> Run AI Optimization</>}
                        </Button>
                        {dbConfig && (
                          <Button
                            type="button"
                            variant="outline"
                            className="bg-black/40 border-zinc-700 text-zinc-300 hover:text-white"
                            disabled={isEstimating || !rawSql.trim()}
                            onClick={estimateCost}
                          >
                            {isEstimating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4 text-indigo-400 mr-2" />}
                            <span>Estimate Cost</span>
                          </Button>
                        )}
                     </div>
                     {estimateResult && (
                       <div className="p-3 rounded-lg border border-zinc-800 bg-black/40 text-xs animate-in fade-in slide-in-from-top-2">
                         <div className="flex items-center gap-2 mb-1.5 font-semibold text-zinc-200">
                           {estimateResult.risk_level === 'HIGH' ? (
                             <ShieldAlert className="h-4 w-4 text-rose-500" />
                           ) : estimateResult.risk_level === 'MEDIUM' ? (
                             <ShieldAlert className="h-4 w-4 text-amber-500" />
                           ) : (
                             <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                           )}
                           Cost Estimation ({estimateResult.risk_level} Risk)
                         </div>
                         <p className="font-mono text-zinc-400 leading-relaxed bg-black/60 p-2 rounded border border-zinc-900">{estimateResult.message}</p>
                       </div>
                     )}
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
                       <div className="text-center">
                         <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
                           <Bot className="w-8 h-8 text-zinc-600" />
                         </div>
                         <p className="text-zinc-400 font-medium">AI Agents Standing By</p>
                         <p className="text-zinc-600 text-xs mt-1">Run optimization to deploy the agent swarm</p>
                       </div>
                     </div>
                  ) : isOptimizing ? (
                      <div className="h-full flex flex-col p-5 overflow-y-auto custom-scrollbar">
                        <div className="flex items-center justify-between gap-2 mb-5">
                          <div className="flex items-center gap-2">
                            <div className="relative">
                              <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></div>
                              <div className="absolute inset-0 w-2 h-2 rounded-full bg-indigo-400 animate-ping"></div>
                            </div>
                            <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">Agent Swarm Active</span>
                          </div>
                          {streamStatus && (
                            <span className="font-mono text-[10px] text-zinc-500 bg-zinc-900/60 border border-zinc-800/60 px-2 py-0.5 rounded">
                              {streamStatus}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col gap-3">
                          {agents.map((agent: any, idx: number) => (
                            <div
                              key={agent.id}
                              className={`relative flex items-center gap-4 p-4 rounded-xl border transition-all duration-500 ${
                                agent.status === "working"
                                  ? "bg-indigo-500/5 border-indigo-500/30 shadow-[0_0_20px_rgba(99,102,241,0.08)]"
                                  : agent.status === "done"
                                  ? "bg-emerald-500/5 border-emerald-500/20"
                                  : "bg-zinc-900/30 border-zinc-800/40 opacity-50"
                              }`}
                            >
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 ${
                                agent.status === "working"
                                  ? "bg-indigo-500/15 text-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.2)]"
                                  : agent.status === "done"
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : "bg-zinc-800/50 text-zinc-600"
                              }`}>
                                {agent.status === "done" ? <CheckCircle2 className="w-5 h-5" /> : agent.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-semibold transition-colors duration-300 ${
                                    agent.status === "working" ? "text-indigo-300" : agent.status === "done" ? "text-emerald-300" : "text-zinc-500"
                                  }`}>{agent.name}</span>
                                  {agent.status === "working" && (
                                    <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />
                                  )}
                                </div>
                                <p className={`text-xs mt-0.5 transition-colors duration-300 ${
                                  agent.status === "working" ? "text-zinc-400" : agent.status === "done" ? "text-zinc-500" : "text-zinc-700"
                                }`}>{agent.description}</p>
                                {agent.status === "working" && (
                                  <div className="mt-2 h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500 rounded-full animate-progress-indeterminate"></div>
                                  </div>
                                )}
                              </div>
                              <div className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-md shrink-0 ${
                                agent.status === "working"
                                  ? "bg-indigo-500/10 text-indigo-400"
                                  : agent.status === "done"
                                  ? "bg-emerald-500/10 text-emerald-400"
                                  : "bg-zinc-800/50 text-zinc-600"
                              }`}>
                                {agent.status === "working" ? "Running" : agent.status === "done" ? "Done" : "Queued"}
                              </div>
                            </div>
                          ))}
                        </div>
                        {traces.length > 0 && (
                          <div className="mt-4 border-t border-zinc-800/50 pt-4 flex flex-col gap-2">
                            <span className="font-mono text-[9px] text-zinc-600 uppercase tracking-widest">Trace Logs</span>
                            <div className="bg-black/40 border border-zinc-800/60 rounded-lg p-3 font-mono text-[10px] text-zinc-400 max-h-[120px] overflow-y-auto custom-scrollbar flex flex-col gap-1">
                              {traces.slice(-3).map((trace: string, i: number) => (
                                <div key={i} className="truncate">
                                  <span className="text-indigo-400 mr-2">&gt;</span>
                                  {trace}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                  ) : outputViewMode === "visual" ? (
                     <div className="h-full p-4 overflow-y-auto custom-scrollbar flex flex-col gap-4 bg-[#0a0a0c]">
                       <ExplainGraph rootNode={parseRawExplainToTree(explainPlan || (optimizationResult && optimizationResult.execution_plan_summary) || "")} />
                     </div>
                  ) : outputViewMode === "explanation" ? (
                     <div className="flex flex-col gap-6 overflow-y-auto custom-scrollbar p-6 h-full">
                         {/* Visual Cost Reduction Comparison */}
                         {optimizationResult?.original_cost !== undefined && (
                           <div className="bg-zinc-950/40 border border-zinc-800/60 rounded-xl p-4.5 space-y-3 shadow-xl shrink-0">
                             <div className="flex items-center justify-between">
                               <div className="flex items-center gap-2">
                                 <Activity className="w-4 h-4 text-emerald-400" />
                                 <h4 className="text-xs font-semibold text-zinc-300 font-mono tracking-wide uppercase">AI Cost Efficiency Evaluation</h4>
                               </div>
                               <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold font-mono px-2 py-0.5 text-[10px]">
                                 {optimizationResult.original_cost > 0 && optimizationResult.new_cost !== undefined ? (
                                   `${Math.round(((optimizationResult.original_cost - optimizationResult.new_cost) / optimizationResult.original_cost) * 100)}% Cost Reduction`
                                 ) : (
                                   "Cost Savings Activated"
                                 )}
                               </Badge>
                             </div>
                             
                             <div className="space-y-2">
                               {/* Cost Bar */}
                               <div className="relative w-full h-3 bg-red-500/10 border border-red-500/20 rounded-full overflow-hidden flex shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]">
                                 {/* New Cost portion (saving bar) */}
                                 <div 
                                   style={{ 
                                     width: optimizationResult.original_cost > 0 && optimizationResult.new_cost !== undefined ? (
                                       `${Math.max(8, Math.min(95, (optimizationResult.new_cost / optimizationResult.original_cost) * 100))}%`
                                     ) : "30%" 
                                   }} 
                                   className="h-full bg-emerald-500 rounded-full border-r border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)] transition-all duration-1000"
                                 />
                               </div>
                               
                               <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500 px-1">
                                 <div className="flex items-center gap-1">
                                   <span className="w-1.5 h-1.5 bg-red-400 rounded-full shrink-0" />
                                   <span>Before Optimization Cost: <strong className="text-red-400/90">{optimizationResult.original_cost}</strong></span>
                                 </div>
                                 <div className="flex items-center gap-1">
                                   <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full shrink-0 animate-ping" />
                                   <span>Optimized Target Cost: <strong className="text-emerald-400">{optimizationResult.new_cost || "N/A"}</strong></span>
                                 </div>
                               </div>
                             </div>
                           </div>
                         )}

                        <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-p:leading-loose prose-pre:bg-[#050505] prose-pre:border prose-pre:border-zinc-800/80 prose-pre:rounded-xl font-light tracking-wide text-zinc-200">
                           <ReactMarkdown>{optimizedOutput}</ReactMarkdown>
                        </div>
                        {optimizationResult?.suggested_indexes && optimizationResult.suggested_indexes.length > 0 && (
                          <div className="space-y-3 mt-4 border-t border-zinc-800/50 pt-6">
                            <h3 className="text-sm font-bold text-zinc-200 flex items-center justify-between">
                              Suggested Indexes
                            </h3>
                            <div className="grid gap-3">
                              {optimizationResult.suggested_indexes.map((idx: any, i: number) => {
                                const statement = typeof idx === 'string' ? idx : idx.statement;
                                const reason = typeof idx === 'object' ? idx.reason : null;
                                return (
                                  <div key={i} className="flex flex-col gap-2 rounded-xl bg-black/40 border border-zinc-850 p-4 transition-colors hover:bg-zinc-900/40">
                                    <pre className="text-xs font-mono text-amber-500/90 whitespace-pre-wrap overflow-x-auto bg-[#050505] p-3 rounded-lg border border-zinc-900">
                                      {statement}
                                    </pre>
                                    {reason && (
                                      <p className="text-xs text-zinc-400">
                                        <span className="font-semibold text-zinc-300">Reason:</span> {reason}
                                      </p>
                                    )}
                                    <IndexEstimator 
                                      indexStatement={statement}
                                      query={rawSql}
                                      dbType={dialect}
                                      dbConfig={dbConfig}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
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
               <CardHeader className="flex flex-row items-center justify-between border-b border-zinc-800/50 pb-4 bg-black/20 shrink-0">
                 <CardTitle className="text-lg text-zinc-100 flex items-center gap-2">
                   <Code2 className="w-5 h-5 text-pink-400" /> Schema Definitions (DDL)
                 </CardTitle>
                 <Sheet open={isSchemaHistoryOpen} onOpenChange={setIsSchemaHistoryOpen}>
                   <SheetTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 bg-black/40 border-zinc-700 text-xs text-zinc-300 hover:text-white flex items-center gap-1.5 px-3">
                        <Clock className="w-3.5 h-3.5" />
                        <span>History</span>
                      </Button>
                   </SheetTrigger>
                   <SheetContent className="w-[400px] sm:w-[540px] bg-[#0a0a0c]/95 border-l border-zinc-800 backdrop-blur-xl flex flex-col h-full overflow-hidden p-6 text-zinc-100">
                     <SheetHeader className="mb-4 shrink-0">
                       <SheetTitle className="text-xl font-semibold text-zinc-100 flex items-center gap-2">
                          <Clock className="w-5 h-5 text-pink-400" />
                          Schema DDL History
                       </SheetTitle>
                       <SheetDescription className="text-zinc-400">
                          View and restore your previous visualized SQL DDL schemas.
                       </SheetDescription>
                     </SheetHeader>

                     <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3.5 min-h-0 pr-1">
                       {schemaHistoryList.length === 0 ? (
                         <div className="text-center py-12 text-zinc-500 font-mono text-xs">
                           No schema history saved yet. Visualizing a schema automatically saves it.
                         </div>
                       ) : (
                         schemaHistoryList.map((item: any) => (
                           <div 
                             key={item.id} 
                             className="group relative border border-zinc-800/80 bg-zinc-900/10 hover:bg-zinc-900/35 p-4 rounded-xl transition-all cursor-pointer flex flex-col gap-2"
                             onClick={() => handleLoadSchemaHistory(item)}
                           >
                             <div className="flex items-center justify-between">
                               <Badge className="bg-pink-500/10 text-pink-400 border border-pink-500/20 font-bold font-mono text-[10px] px-2 py-0.5">
                                 {item.table_count} tables
                               </Badge>
                               <div className="flex items-center gap-2">
                                 <span className="text-[10px] text-zinc-500 font-mono">
                                   {format(new Date(item.created_at), "MMM d, yyyy h:mm a")}
                                 </span>
                                 <Button
                                   size="icon"
                                   variant="ghost"
                                   className="h-6 w-6 text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-0"
                                   onClick={(e) => handleDeleteSchemaHistory(e, item.id)}
                                 >
                                   <Trash2 className="h-3.5 w-3.5" />
                                 </Button>
                               </div>
                             </div>
                             <pre className="text-[10px] font-mono text-zinc-400/90 whitespace-pre-wrap overflow-x-auto bg-black/40 p-2.5 rounded-lg border border-zinc-900/50 max-h-[120px]">
                               {item.ddl}
                             </pre>
                           </div>
                         ))
                       )}
                     </div>
                   </SheetContent>
                 </Sheet>
               </CardHeader>
               <CardContent className="p-0 flex-1 flex flex-col min-h-0">
                  {/* AI DDL Copilot Input Box */}
                  <div className="p-3 bg-zinc-950/40 border-b border-zinc-800/50 flex gap-2 items-center shrink-0">
                    <div className="flex-1 flex items-center gap-1.5 bg-black/40 border border-zinc-800 rounded-md px-2.5 py-1">
                      <Sparkles className="w-3.5 h-3.5 text-pink-400 animate-pulse shrink-0" />
                      <input 
                        type="text"
                        value={copilotPrompt}
                        onChange={(e) => setCopilotPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleGenerateDDL();
                        }}
                        placeholder="AI Copilot: Describe tables to generate DDL..."
                        disabled={isGeneratingDDL}
                        className="flex-1 bg-transparent text-xs text-zinc-200 focus:outline-none placeholder-zinc-600 disabled:opacity-50"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={handleGenerateDDL}
                      disabled={isGeneratingDDL || !copilotPrompt.trim()}
                      className="bg-pink-600 hover:bg-pink-500 text-white font-medium text-xs h-7 px-3 shrink-0 flex items-center gap-1.5"
                    >
                      {isGeneratingDDL ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      <span>Generate</span>
                    </Button>
                  </div>
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
               <CardContent className="p-0 flex-1 min-h-0 bg-[#0a0a0c] relative">
                 <SchemaErd 
                   schemaText={visualizedSchema} 
                   onTableAction={(tableName, actionPrompt) => {
                     setRawSql(`SELECT * FROM ${tableName};`);
                     setSchemaContext(schemaDDL);
                     setView("sql-optimizer");
                     setTimeout(() => {
                       handleOptimize(`SELECT * FROM ${tableName};`);
                     }, 300);
                     toast.success(`Active focus shifted to table ${tableName} for optimization!`);
                   }} 
                 />
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
                                          <Button 
                                            size="sm" 
                                            variant="outline" 
                                            className="border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 h-7 px-3 text-xs flex items-center gap-1.5 shadow-[0_0_12px_rgba(99,102,241,0.25)]" 
                                            onClick={() => {
                                              setRawSql(q.query);
                                              setSchemaContext(schemaDDL);
                                              setView("sql-optimizer");
                                              setTimeout(() => handleOptimize(q.query), 300);
                                            }}
                                          >
                                            <Sparkles className="w-3 h-3 text-indigo-400" />
                                            <span>AI Optimize</span>
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
