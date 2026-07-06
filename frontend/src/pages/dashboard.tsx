import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Database, Play, Code2, ShieldAlert, Cpu, CheckCircle2, ChevronRight, Copy, Loader2, Sparkles, Wand2, Calculator } from "lucide-react";
import { 
  useAnalyzeQuery, 
  getGetHistoryQueryKey,
  getGetStatsQueryKey
} from "@workspace/api-client-react";
import { useAuth } from "@clerk/react";
import type { AnalyzeInput, OptimizationResult, Bottleneck } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import ReactDiffViewer from "react-diff-viewer-continued";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { format as formatSql } from "sql-formatter";
import { VisualExplain } from "@/components/VisualExplain";
import { parseRawExplainToTree } from "@/lib/explainParser";
import { useTheme } from "next-themes";

import { CardContent } from "@/components/ui/card";
import { IndexEstimator } from "@/components/IndexEstimator";
import { useAppStore } from "@/store/useAppStore";
import { parseSqlSchemaToNodes } from "@/utils/sqlParser";
import { ExplainGraph } from "@/components/ExplainGraph";
import { AgentSwarm } from "@/components/AgentSwarm";

function parsePartialJson(text: string): Partial<OptimizationResult> {
  const result: Partial<OptimizationResult> = {};
  try {
    const oqMatch = text.match(/"optimized_query"\s*:\s*"((?:\\.|[^"\\])*)/);
    if (oqMatch) result.optimized_query = oqMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    
    const expMatch = text.match(/"explanation"\s*:\s*"((?:\\.|[^"\\])*)/);
    if (expMatch) result.explanation = expMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    
    const estMatch = text.match(/"estimated_improvement"\s*:\s*"((?:\\.|[^"\\])*)/);
    if (estMatch) result.estimated_improvement = estMatch[1];
    
    const execMatch = text.match(/"execution_plan_summary"\s*:\s*"((?:\\.|[^"\\])*)/);
    if (execMatch) result.execution_plan_summary = execMatch[1];
    
    const compMatch = text.match(/"query_complexity_score"\s*:\s*(\d+)/);
    if (compMatch) result.query_complexity_score = parseInt(compMatch[1], 10);
  } catch (e) {}
  return result;
}

const formSchema = z.object({
  db_type: z.enum(["postgresql", "mysql"]),
  query: z.string().min(5, "Query must be at least 5 characters"),
  mode: z.enum(["live", "manual"]),
  
  // Live fields
  host: z.string().optional(),
  port: z.string().optional(), // Using string for form, parse to int
  database: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  
  // Manual fields
  manual_schema: z.string().optional(),
  explain_output: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.mode === 'live') {
    if (!data.host) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Required", path: ["host"] });
    if (!data.port) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Required", path: ["port"] });
    if (!data.database) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Required", path: ["database"] });
    if (!data.username) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Required", path: ["username"] });
  }
});

type FormValues = z.infer<typeof formSchema>;

let cachedResult: OptimizationResult | null = null;
let cachedRawLlmContent = "";
let cachedStreamBottlenecks: Bottleneck[] = [];
let cachedRawExplain = "";
let cachedFormValues: Partial<FormValues> | null = null;

export default function DashboardPage() {
  const { theme } = useTheme();
  const [result, setResult] = useState<OptimizationResult | null>(cachedResult);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string>("");
  const [rawLlmContent, setRawLlmContent] = useState(cachedRawLlmContent);
  const [streamBottlenecks, setStreamBottlenecks] = useState<Bottleneck[]>(cachedStreamBottlenecks);
  const [rawExplain, setRawExplain] = useState<string>(cachedRawExplain);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [explanationResult, setExplanationResult] = useState<{explanation: string, corrected_query: string} | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isEstimating, setIsEstimating] = useState(false);
  const [estimateResult, setEstimateResult] = useState<{ cost: number, rows: number, risk_level: string, message: string } | null>(null);
  const [traces, setTraces] = useState<string[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isIncomingEdit = useRef<boolean>(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rId = params.get("room");
    if (rId) {
      setRoomId(rId);
      const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
      const baseHost = window.location.host;
      const wsUrl = `${wsScheme}://${baseHost.includes("localhost") || baseHost.includes("127.0.0.1") ? "localhost:8000" : baseHost}/api/ws/collaboration/${rId}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "sql-update") {
            isIncomingEdit.current = true;
            form.setValue("query", data.sql);
            setTimeout(() => {
              isIncomingEdit.current = false;
            }, 50);
          }
        } catch (e) {
          console.error("Websocket parsing error", e);
        }
      };

      return () => {
        ws.close();
      };
    }
  }, [form]);

  const watchQuery = form.watch("query");
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && !isIncomingEdit.current && watchQuery) {
      wsRef.current.send(JSON.stringify({
        type: "sql-update",
        sql: watchQuery
      }));
    }
  }, [watchQuery]);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  
  const { credentials, setCredentials, rawSchema, setRawSchema, setParsedNodes } = useAppStore();
  
  const partialResult = rawLlmContent ? parsePartialJson(rawLlmContent) : null;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: cachedFormValues || {
      db_type: credentials?.db_type || "postgresql",
      query: "",
      mode: "manual",
      host: credentials?.host || "localhost",
      port: credentials?.port || "5432",
      database: credentials?.database || "",
      username: credentials?.username || "postgres",
      password: credentials?.password || "",
      manual_schema: rawSchema || "",
      explain_output: "",
    },
  });

  useEffect(() => {
    const prefillQuery = sessionStorage.getItem('prefillQuery');
    if (prefillQuery) {
      form.setValue('query', prefillQuery);
      sessionStorage.removeItem('prefillQuery');
    }
  }, [form]);

  const watchMode = form.watch("mode");
  const watchValues = form.watch();

  // Save to cache on every change so it survives component unmounts
  useEffect(() => {
    cachedResult = result;
    cachedRawLlmContent = rawLlmContent;
    cachedStreamBottlenecks = streamBottlenecks;
    cachedRawExplain = rawExplain;
    cachedFormValues = watchValues;
    
    // Sync to global store safely to prevent infinite loops
    if (watchValues.mode === 'live' || watchValues.mode === 'manual') {
      const isDifferent = 
        credentials?.db_type !== watchValues.db_type ||
        credentials?.host !== watchValues.host ||
        credentials?.port !== watchValues.port ||
        credentials?.database !== watchValues.database ||
        credentials?.username !== watchValues.username ||
        credentials?.password !== watchValues.password;
        
      if (isDifferent) {
        setCredentials({
          db_type: watchValues.db_type as any,
          host: watchValues.host,
          port: watchValues.port,
          database: watchValues.database,
          username: watchValues.username,
          password: watchValues.password,
        });
      }
    }
    
    if (watchValues.manual_schema !== undefined && watchValues.manual_schema !== rawSchema) {
      setRawSchema(watchValues.manual_schema);
      try {
        setParsedNodes(parseSqlSchemaToNodes(watchValues.manual_schema));
      } catch (e) {
        console.error("Failed to parse SQL schema", e);
      }
    }
  }, [result, rawLlmContent, streamBottlenecks, rawExplain, watchValues, credentials, rawSchema]);
  const watchDbType = form.watch("db_type");

  useEffect(() => {
    const currentPort = form.getValues("port");
    const currentUsername = form.getValues("username");

    if (watchDbType === 'mysql') {
      if (!currentPort || currentPort === '5432') form.setValue("port", "3306");
      if (!currentUsername || currentUsername === 'postgres') form.setValue("username", "root");
    } else if (watchDbType === 'postgresql') {
      if (!currentPort || currentPort === '3306') form.setValue("port", "5432");
      if (!currentUsername || currentUsername === 'root') form.setValue("username", "postgres");
    }
  }, [watchDbType, form]);

  const onSubmit = async (values: FormValues) => {
    const input: AnalyzeInput = {
      query: values.query,
      db_type: values.db_type,
    };

    if (values.mode === 'live') {
      input.db_config = {
        db_type: values.db_type,
        host: values.host!,
        port: parseInt(values.port!, 10),
        database: values.database!,
        username: values.username!,
        password: values.password || "",
      };
    } else {
      if (values.manual_schema) input.manual_schema = values.manual_schema;
      if (values.explain_output) input.explain_output = values.explain_output;
    }

    setIsStreaming(true);
    setResult(null);
    setRawLlmContent("");
    setStreamBottlenecks([]);
    setRawExplain("");
    setExecutionError(null);
    setExplanationResult(null);
    setEstimateResult(null);
    setStreamStatus("Initializing...");
    setTraces([]);

    try {
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/langgraph-analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(input)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.detail || "Failed to start analysis");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No readable stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let currentBottlenecks: Bottleneck[] = [];
      let savedId: number | null = null;

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

          if (data) {
            let parsedData;
            try {
              parsedData = JSON.parse(data);
            } catch(e) { continue; }
            
            if (eventType === "status") setStreamStatus(parsedData);
            if (eventType === "trace") {
              setTraces(prev => [...prev, parsedData.step]);
            }
            if (eventType === "bottlenecks") {
              setStreamBottlenecks(parsedData);
              currentBottlenecks = parsedData;
            }
            if (eventType === "chunk") {
              fullContent += JSON.stringify(parsedData); // chunk is JSON now
              setRawLlmContent(fullContent);
            }
            if (eventType === "savedId") {
              savedId = parsedData;
            }
            if (eventType === "raw_explain") {
              setRawExplain(parsedData);
            }
            if (eventType === "error") {
              toast({ title: "Error", description: parsedData, variant: "destructive" });
              setExecutionError(parsedData);
              setIsStreaming(false);
              return;
            }
            if (eventType === "done") {
               let clean = fullContent.trim();
               const jsonMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
               if (jsonMatch) {
                 clean = jsonMatch[1].trim();
               } else {
                 const firstBrace = clean.indexOf("{");
                 const lastBrace = clean.lastIndexOf("}");
                 if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
                   clean = clean.substring(firstBrace, lastBrace + 1).trim();
                 }
               }
               try {
                 const finalJson = JSON.parse(clean);
                 setResult({
                   ...finalJson,
                   id: savedId,
                   bottlenecks: currentBottlenecks.length ? currentBottlenecks : (finalJson.bottlenecks || []),
                   original_query: values.query,
                   db_type: values.db_type,
                 });
                 toast({
                   title: "Optimization Complete",
                   description: "Query has been successfully analyzed.",
                 });
                 queryClient.invalidateQueries({ queryKey: getGetHistoryQueryKey() });
                 queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
               } catch(e) {
                 toast({ title: "Parsing Error", description: "Could not parse AI response", variant: "destructive" });
               }
            }
          }
        }
      }
    } catch (err: any) {
      toast({
        title: "Optimization Failed",
        description: err?.message || "An error occurred while analyzing the query.",
        variant: "destructive",
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const explainError = async () => {
    if (!executionError) return;
    setIsExplaining(true);
    setExplanationResult(null);
    try {
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/errors/explain`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          query: form.getValues().query,
          error_message: executionError,
          db_type: form.getValues().db_type,
          schema: form.getValues().manual_schema
        })
      });
      if (!res.ok) throw new Error("Failed to explain error");
      const data = await res.json();
      setExplanationResult(data);
    } catch (err: any) {
      toast({ title: "Failed to explain", description: err.message, variant: "destructive" });
    } finally {
      setIsExplaining(false);
    }
  };

  const estimateCost = async () => {
    setIsEstimating(true);
    setEstimateResult(null);
    try {
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const token = await getToken();
      const input = {
        query: form.getValues().query,
        db_config: {
          db_type: form.getValues().db_type,
          host: form.getValues().host,
          port: parseInt(form.getValues().port || "5432", 10),
          database: form.getValues().database,
          username: form.getValues().username,
          password: form.getValues().password || "",
        }
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
    } catch (err: any) {
      toast({ title: "Estimation Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsEstimating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Copied to clipboard.",
    });
  };

  const getBottleneckColor = (severity: string) => {
    switch (severity) {
      case "HIGH": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "MEDIUM": return "bg-orange-500/10 text-orange-500 border-orange-500/20";
      case "LOW": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      default: return "bg-primary/10 text-primary border-primary/20";
    }
  };

  return (
    <div className="flex h-full w-full">
      {/* Left Panel - Input */}
      <div className="w-1/2 min-w-[500px] border-r border-border flex flex-col bg-card overflow-hidden z-10 shadow-xl">
        <div className="p-4 border-b border-border bg-muted/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <Code2 className="h-4 w-4 text-primary" />
            Query Editor
          </div>
          <div className="flex items-center gap-2">
            {roomId ? (
              <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 border-amber-500/20 font-mono text-[9px] flex items-center gap-1.5 h-6">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                </span>
                Live Room: {roomId}
              </Badge>
            ) : (
              <Button 
                variant="outline" 
                size="sm" 
                type="button"
                className="h-6 text-[10px] px-2 border-primary/20 text-primary hover:bg-primary/5 font-semibold"
                onClick={() => {
                  const newRoom = Math.random().toString(36).substring(2, 9);
                  window.history.pushState({}, "", `?room=${newRoom}`);
                  setRoomId(newRoom);
                  toast({
                    title: "Collaborative Room Created",
                    description: "Share this browser URL to edit query SQL in real-time together!",
                  });
                }}
              >
                Collaborate Live
              </Button>
            )}
            <Badge variant="outline" className="bg-background font-mono text-[10px] h-6 flex items-center">
              {watchDbType.toUpperCase()}
            </Badge>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="db_type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Database Engine</FormLabel>
                        <Select onValueChange={(val) => {
                          field.onChange(val);
                          if (val === 'postgresql') form.setValue('port', '5432');
                          if (val === 'mysql') form.setValue('port', '3306');
                        }} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="font-mono text-sm bg-background">
                              <SelectValue placeholder="Select DB" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="postgresql" className="font-mono text-sm">PostgreSQL</SelectItem>
                            <SelectItem value="mysql" className="font-mono text-sm">MySQL</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="mode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Connection Mode</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="font-mono text-sm bg-background">
                              <SelectValue placeholder="Select Mode" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="manual" className="font-mono text-sm">Manual Input</SelectItem>
                            <SelectItem value="live" className="font-mono text-sm">Live Database</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>

                {watchMode === 'live' && (
                  <div className="rounded-lg border border-border p-4 bg-muted/10 space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Database className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-medium">Connection Details</h3>
                    </div>
                    <div className="grid grid-cols-4 gap-4">
                      <FormField
                        control={form.control}
                        name="host"
                        render={({ field }) => (
                          <FormItem className="col-span-3">
                            <FormLabel className="text-xs">Host</FormLabel>
                            <FormControl><Input {...field} className="h-8 font-mono text-xs bg-background" /></FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="port"
                        render={({ field }) => (
                          <FormItem className="col-span-1">
                            <FormLabel className="text-xs">Port</FormLabel>
                            <FormControl><Input {...field} className="h-8 font-mono text-xs bg-background" /></FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="database"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Database</FormLabel>
                            <FormControl><Input {...field} className="h-8 font-mono text-xs bg-background" /></FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">User</FormLabel>
                            <FormControl><Input {...field} className="h-8 font-mono text-xs bg-background" /></FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Password</FormLabel>
                            <FormControl><Input type="password" {...field} className="h-8 font-mono text-xs bg-background" /></FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="query"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex justify-between items-center">
                        SQL Query
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 text-xs px-2"
                          onClick={() => {
                            try {
                              const formatted = formatSql(form.getValues().query, { language: 'postgresql' });
                              form.setValue("query", formatted);
                            } catch (e) {
                              toast({ title: "Error formatting SQL", variant: "destructive" });
                            }
                          }}
                        >
                          Format SQL
                        </Button>
                      </FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="SELECT * FROM..." 
                          className="min-h-[250px] font-mono text-sm bg-muted/30 border-input text-foreground focus-visible:ring-primary/50" 
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {watchMode === 'manual' && (
                  <Tabs defaultValue="schema" className="w-full">
                    <TabsList className="w-full grid grid-cols-2 bg-muted/50 p-1">
                      <TabsTrigger value="schema" className="text-xs">Table Schema (DDL)</TabsTrigger>
                      <TabsTrigger value="explain" className="text-xs">EXPLAIN ANALYZE</TabsTrigger>
                    </TabsList>
                    <TabsContent value="schema" className="mt-2">
                      <FormField
                        control={form.control}
                        name="manual_schema"
                        render={({ field }) => (
                          <FormItem>
                            <FormDescription className="text-[11px] mb-2">Provide table definitions for better index recommendations.</FormDescription>
                            <FormControl>
                              <Textarea 
                                placeholder="CREATE TABLE users (..." 
                                className="min-h-[150px] font-mono text-xs bg-background" 
                                {...field} 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </TabsContent>
                    <TabsContent value="explain" className="mt-2">
                      <FormField
                        control={form.control}
                        name="explain_output"
                        render={({ field }) => (
                          <FormItem>
                            <FormDescription className="text-[11px] mb-2">Paste query execution plan to identify exact bottlenecks.</FormDescription>
                            <FormControl>
                              <Textarea 
                                placeholder="Hash Join  (cost=...)" 
                                className="min-h-[150px] font-mono text-xs bg-background" 
                                {...field} 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </TabsContent>
                  </Tabs>
                )}

                <div className="pt-4 pb-10">
                  <div className="flex gap-4">
                    <Button 
                      type="submit" 
                      className="flex-1 h-12 text-md font-bold shadow-lg shadow-primary/20"
                      disabled={isStreaming}
                    >
                      {isStreaming ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          {streamStatus || "Analyzing..."}
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-5 w-5 fill-current" />
                          Analyze & Optimize
                        </>
                      )}
                    </Button>
                    {watchMode === 'live' && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-12 px-6 shadow-sm border-primary/20 hover:bg-primary/5"
                        disabled={isEstimating || !form.getValues().query}
                        onClick={estimateCost}
                      >
                        {isEstimating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Calculator className="h-5 w-5 text-primary" />}
                        <span className="ml-2">Estimate Cost</span>
                      </Button>
                    )}
                  </div>
                  {estimateResult && (
                    <div className="mt-4 p-4 rounded-lg border border-border bg-card shadow-sm animate-in fade-in slide-in-from-top-2">
                      <div className="flex items-center gap-3 mb-2">
                        {estimateResult.risk_level === 'HIGH' ? (
                          <ShieldAlert className="h-5 w-5 text-destructive" />
                        ) : estimateResult.risk_level === 'MEDIUM' ? (
                          <ShieldAlert className="h-5 w-5 text-orange-500" />
                        ) : (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        )}
                        <h4 className="font-bold">Cost Estimation</h4>
                      </div>
                      <p className="text-sm text-muted-foreground font-mono bg-muted/50 p-2 rounded">{estimateResult.message}</p>
                    </div>
                  )}
                </div>
              </form>
            </Form>
          </div>
        </ScrollArea>
      </div>

      {/* Right Panel - Results */}
      <div className="flex-1 min-w-0 bg-background border-l border-border flex flex-col overflow-hidden relative">
        {!result && !isStreaming && !executionError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
            <div className="relative w-full max-w-lg p-10 rounded-2xl bg-gradient-to-b from-card/50 to-background border border-border shadow-2xl flex flex-col items-center text-center overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/0 via-primary to-primary/0 opacity-50"></div>
              
              <div className="relative mb-8">
                <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl"></div>
                <div className="h-20 w-20 bg-card border border-primary/30 rounded-2xl shadow-inner flex items-center justify-center relative z-10 transform -rotate-6 transition-transform hover:rotate-0 duration-300">
                  <Wand2 className="h-10 w-10 text-primary" />
                </div>
                <Sparkles className="absolute -top-2 -right-2 h-6 w-6 text-yellow-500 animate-pulse" />
              </div>
              
              <h2 className="text-2xl font-bold text-foreground mb-3">Ready to Optimize</h2>
              <p className="text-muted-foreground text-sm leading-relaxed mb-8 max-w-[80%]">
                Enter your SQL query and database schema on the left. Our AI engine will parse the abstract syntax tree, 
                simulate the planner, and generate an optimal execution strategy.
              </p>
              
              <div className="grid grid-cols-2 gap-4 w-full">
                <div className="bg-background/50 border border-border rounded-lg p-4 flex flex-col items-center">
                  <ShieldAlert className="h-5 w-5 text-orange-500 mb-2" />
                  <span className="text-xs font-medium">Find Bottlenecks</span>
                </div>
                <div className="bg-background/50 border border-border rounded-lg p-4 flex flex-col items-center">
                  <CheckCircle2 className="h-5 w-5 text-green-500 mb-2" />
                  <span className="text-xs font-medium">Get Indexes</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {isStreaming && !rawLlmContent && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/50 backdrop-blur-sm z-50 p-6 overflow-y-auto">
            <div className="relative mb-6">
              <div className="h-16 w-16 rounded-full border-t-2 border-l-2 border-primary animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <Database className="h-6 w-6 text-primary animate-pulse" />
              </div>
            </div>
            <div className="w-full max-w-4xl">
              <AgentSwarm traces={traces} status={streamStatus || "Evaluating Query Plan..."} />
            </div>
          </div>
        )}

        {executionError && !isStreaming && (
          <ScrollArea className="flex-1">
            <div className="p-6">
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6">
                <h2 className="text-xl font-bold text-destructive flex items-center gap-2 mb-4">
                  <ShieldAlert className="h-6 w-6" />
                  Query Execution Failed
                </h2>
                <div className="bg-background/80 rounded border border-border p-3 mb-4">
                  <p className="font-mono text-sm whitespace-pre-wrap text-destructive/90">{executionError}</p>
                </div>
                <Button 
                  onClick={explainError}
                  disabled={isExplaining}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isExplaining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                  Explain Error with AI
                </Button>
              </div>

              {explanationResult && (
                <div className="mt-6 space-y-6 animate-in slide-in-from-bottom-2">
                  <div className="rounded-lg border border-border p-5 bg-card shadow-sm">
                    <h3 className="font-bold text-lg border-b border-border pb-3 mb-3 flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-primary" />
                      AI Explanation
                    </h3>
                    <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                      {explanationResult.explanation}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
                    <div className="bg-muted/50 p-3 border-b border-border flex justify-between items-center">
                      <h3 className="font-bold flex items-center gap-2 text-foreground">
                        <Code2 className="h-4 w-4" />
                        Corrected Query
                      </h3>
                      <Button size="sm" onClick={() => {
                        form.setValue("query", explanationResult.corrected_query);
                        setExecutionError(null);
                        setExplanationResult(null);
                        toast({ title: "Fix applied", description: "The corrected query has been placed in the editor." });
                      }}>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Apply Fix
                      </Button>
                    </div>
                    <pre className="text-sm font-mono bg-background p-4 overflow-x-auto text-foreground/90">
                      {explanationResult.corrected_query}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {(result || rawLlmContent) && !executionError && (
          <ScrollArea className="flex-1">
            <div className="p-6 space-y-8 pb-20">
              
              {/* Agent Swarm Tracer Visualizer */}
              {(isStreaming || traces.length > 0) && (
                <AgentSwarm traces={traces} status={streamStatus || (result ? "Workflow Complete" : "Processing...")} />
              )}

              {/* Header / Banner */}
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 flex items-start gap-4">
                <div className="rounded-full bg-green-500/20 p-2 shrink-0">
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                </div>
                <div className="w-full">
                  <h2 className="text-lg font-bold text-green-600 flex flex-wrap items-center gap-2">
                    {result ? "Optimization Successful" : "Optimizing in Real-Time..."}
                    {(result?.estimated_improvement || partialResult?.estimated_improvement) ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/30 whitespace-normal text-left mt-1 sm:mt-0">
                        ~{result?.estimated_improvement || partialResult?.estimated_improvement}
                      </Badge>
                    ) : isStreaming ? (
                      <span className="w-24 h-6 bg-green-500/20 animate-pulse rounded"></span>
                    ) : null}
                  </h2>
                  <div className="text-sm text-green-700 mt-1 min-h-[20px]">
                    {result?.execution_plan_summary || partialResult?.execution_plan_summary || (
                      isStreaming && <span className="w-full max-w-md h-4 bg-green-500/20 animate-pulse rounded block"></span>
                    )}
                  </div>
                </div>
                {/* Complexity Meter */}
                {(result?.query_complexity_score !== undefined || partialResult?.query_complexity_score !== undefined) && (
                  <div className="ml-auto flex flex-col items-end shrink-0">
                    <div className="text-xs font-bold text-green-700 uppercase tracking-wider mb-1">Complexity</div>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-green-500/20 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-green-500 transition-all duration-500"
                          style={{ width: `${result?.query_complexity_score || partialResult?.query_complexity_score}%` }}
                        ></div>
                      </div>
                      <span className="text-sm font-mono font-bold text-green-600">
                        {result?.query_complexity_score || partialResult?.query_complexity_score}/100
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottlenecks */}
              {((result?.bottlenecks || streamBottlenecks).length > 0) && (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-border/50 pb-2">
                    <ShieldAlert className="h-4 w-4 text-orange-500" />
                    Identified Bottlenecks
                  </h3>
                  <div className="grid gap-3">
                    {(result?.bottlenecks || streamBottlenecks).map((b: Bottleneck, i: number) => (
                      <div key={i} className="flex items-start gap-3 rounded bg-card/50 border border-border p-3 transition-colors hover:bg-muted/50 cursor-default">
                        <TooltipProvider>
                          <Tooltip delayDuration={300}>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className={`font-mono text-[10px] shrink-0 cursor-help ${getBottleneckColor(b.severity)}`}>
                                {b.type}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[300px] text-xs">
                              {b.type === "Sequential Scan" && "A sequential scan reads every row in the table, which is very slow for large tables. Adding an index can fix this."}
                              {b.type === "Missing Index" && "The database planner suggests an index to speed up row retrieval."}
                              {b.type === "Cartesian Product" && "A join without a condition multiplies rows, creating a huge intermediate result. Add a JOIN condition."}
                              {b.type === "Bad Join Order" && "Joining large tables first wastes memory. Let the planner or indices filter early."}
                              {b.type === "Inefficient Subquery" && "Correlated subqueries execute per row. A JOIN is usually much faster."}
                              {!["Sequential Scan", "Missing Index", "Cartesian Product", "Bad Join Order", "Inefficient Subquery"].includes(b.type) && "This bottleneck degrades performance."}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {b.table && <span className="text-primary mr-2 font-mono text-xs">{b.table}</span>}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {b.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Visual EXPLAIN Plan */}
              {(rawExplain || form.getValues().explain_output) && (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-border/50 pb-2">
                    <Database className="h-4 w-4 text-primary" />
                    Execution Plan Analysis
                  </h3>
                  <Tabs defaultValue="visual" className="w-full">
                    <TabsList className="bg-muted/50 p-1 mb-2">
                      <TabsTrigger value="visual" className="text-xs">Interactive Flow Graph</TabsTrigger>
                      <TabsTrigger value="tree" className="text-xs">Plan Tree View</TabsTrigger>
                    </TabsList>
                    <TabsContent value="visual" className="mt-0 animate-in fade-in duration-300">
                      <ExplainGraph rootNode={parseRawExplainToTree(rawExplain || form.getValues().explain_output || "")} />
                    </TabsContent>
                    <TabsContent value="tree" className="mt-0">
                      <div className="p-3 rounded bg-card/50 border border-border overflow-x-auto max-w-full">
                        <VisualExplain node={parseRawExplainToTree(rawExplain || form.getValues().explain_output || "") as any} />
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              )}

              {/* Code Diff */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-foreground flex items-center justify-between border-b border-border/50 pb-2">
                  Query Transformation
                  {result && (
                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => copyToClipboard(result.optimized_query)}>
                      <Copy className="h-3 w-3 mr-2" />
                      Copy Optimized
                    </Button>
                  )}
                </h3>
                <div className="rounded-lg border border-border overflow-hidden max-w-[100vw] sm:max-w-full bg-[#0a0a0c] p-4 shadow-inner flex flex-col gap-6">
                  {result?.optimized_query || partialResult?.optimized_query ? (
                    <>
                      <div className="flex flex-col border border-zinc-800/80 rounded-lg overflow-hidden shadow-sm">
                        <div className="bg-red-950/20 text-red-400 px-4 py-2 text-xs font-semibold tracking-wider border-b border-zinc-800/80 uppercase">Original Query (Old)</div>
                        <pre className="p-4 m-0 bg-[#050505] text-zinc-300 font-mono text-xs md:text-sm whitespace-pre-wrap overflow-x-auto leading-relaxed">
                          {result?.original_query || form.getValues().query || "-- No original query provided."}
                        </pre>
                      </div>
                      <div className="flex flex-col border border-zinc-800/80 rounded-lg overflow-hidden shadow-sm">
                        <div className="bg-green-950/20 text-green-400 px-4 py-2 text-xs font-semibold tracking-wider border-b border-zinc-800/80 uppercase">Optimized Query (New)</div>
                        <pre className="p-4 m-0 bg-[#050505] text-zinc-300 font-mono text-xs md:text-sm whitespace-pre-wrap overflow-x-auto leading-relaxed">
                          {(() => {
                            const raw = result?.optimized_query || partialResult?.optimized_query || "";
                            if (!raw) return "";
                            try { return formatSql(raw, { language: 'postgresql' }); }
                            catch { return raw; }
                          })()}
                        </pre>
                      </div>
                    </>
                  ) : (
                    <div className="bg-muted/50 p-4 relative min-w-0">
                      <div className="text-[10px] font-mono text-green-600/80 mb-3 uppercase tracking-wider flex items-center gap-2">
                        Optimized Query
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                      </div>
                      <div className="space-y-2 w-full mt-2">
                        <div className="h-3 bg-muted animate-pulse rounded w-full"></div>
                        <div className="h-3 bg-muted animate-pulse rounded w-5/6"></div>
                        <div className="h-3 bg-muted animate-pulse rounded w-4/6"></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Explanation */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-foreground border-b border-border/50 pb-2 flex items-center gap-2">
                  Optimization Strategy
                  {isStreaming && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                </h3>
                <div className="text-sm text-muted-foreground leading-relaxed prose prose-invert max-w-none min-h-[60px]">
                  {result?.explanation || partialResult?.explanation ? (
                    <p>
                      {result?.explanation || partialResult?.explanation}
                      {isStreaming && <span className="inline-block w-2 h-3 bg-primary animate-pulse ml-1 align-middle"></span>}
                    </p>
                  ) : isStreaming ? (
                    <div className="space-y-2 w-full">
                      <div className="h-4 bg-muted animate-pulse rounded w-full"></div>
                      <div className="h-4 bg-muted animate-pulse rounded w-full"></div>
                      <div className="h-4 bg-muted animate-pulse rounded w-3/4"></div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Suggested Indexes */}
              {(result?.suggested_indexes && result.suggested_indexes.length > 0) && (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-foreground border-b border-border/50 pb-2 flex items-center justify-between">
                    Suggested Indexes
                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => {
                      const allStatements = result.suggested_indexes
                        .map((idx: any) => typeof idx === 'string' ? idx : idx.statement)
                        .join("\n");
                      copyToClipboard(allStatements);
                    }}>
                      <Copy className="h-3 w-3 mr-2" />
                      Copy All
                    </Button>
                  </h3>
                  <div className="bg-muted/50 rounded-lg border border-border overflow-hidden">
                    {result.suggested_indexes.map((idx: any, i: number) => (
                      <div key={i} className="flex flex-col group border-b border-border last:border-0 p-3 relative hover:bg-muted/80 transition-colors">
                        <div className="flex justify-between items-start gap-4">
                          <pre className="text-xs font-mono text-yellow-700 whitespace-pre-wrap overflow-x-auto flex-1 bg-background/50 p-2 rounded border border-border/50">
                            {typeof idx === 'string' ? idx : idx.statement}
                          </pre>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="shrink-0 h-6 w-6 text-muted-foreground hover:text-primary"
                            onClick={() => copyToClipboard(typeof idx === 'string' ? idx : idx.statement)}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        {typeof idx === 'object' && idx.reason && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground/80">Reason:</span> {idx.reason}
                          </div>
                        )}
                        <IndexEstimator 
                          indexStatement={typeof idx === 'string' ? idx : idx.statement}
                          query={result?.original_query || form.getValues().query}
                          dbType={result?.db_type || form.getValues().db_type}
                          dbConfig={form.getValues().mode === 'live' ? {
                            host: form.getValues().host,
                            port: parseInt(form.getValues().port || "5432", 10),
                            database: form.getValues().database,
                            username: form.getValues().username,
                            password: form.getValues().password
                          } : undefined}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
