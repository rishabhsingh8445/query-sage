import { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { Activity, Database, Loader2, Play, AlertTriangle, AlertCircle, RefreshCw, Zap } from "lucide-react";
import { useLocation } from "wouter";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format as formatSql } from "sql-formatter";
import { useAppStore } from "@/store/useAppStore";

interface SlowQuery {
  query: string;
  calls: number;
  total_time_sec: string;
  mean_time_ms: string;
  max_time_ms: string;
  rows: number;
}

export default function MonitorPage() {
  const { credentials, setCredentials } = useAppStore();
  const [isPolling, setIsPolling] = useState(false);
  
  const [queries, setQueries] = useState<SlowQuery[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  const { getToken } = useAuth();
  const [, setLocation] = useLocation();

  const fetchQueries = async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/monitor/slow-queries`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          db_type: credentials?.db_type || 'postgresql',
          host: credentials?.host || 'localhost',
          port: parseInt(credentials?.port || '5432', 10),
          database: credentials?.database || '',
          username: credentials?.username || '',
          password: credentials?.password || ''
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to connect to database");
      }

      const data = await res.json();
      setQueries(data.queries || []);
    } catch (err: any) {
      setError(err.message);
      setIsPolling(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let intervalId: any;
    if (isPolling) {
      fetchQueries();
      intervalId = setInterval(fetchQueries, 10000); // Poll every 10s
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isPolling]);

  return (
    <div className="flex h-full w-full bg-background">
      {/* Sidebar for connection */}
      <div className="w-80 border-r border-border bg-card p-6 flex flex-col z-10 shadow-xl overflow-y-auto shrink-0">
        <h2 className="text-xl font-bold flex items-center gap-2 mb-6">
          <Activity className="h-5 w-5 text-primary" />
          Live Monitor
        </h2>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Database Engine</Label>
            <Select 
              value={credentials?.db_type || "postgresql"} 
              onValueChange={(val) => setCredentials({ db_type: val as any })}
              disabled={isPolling}
            >
              <SelectTrigger className="font-mono text-xs h-9">
                <SelectValue placeholder="Select Database" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="postgresql">PostgreSQL</SelectItem>
                <SelectItem value="mysql">MySQL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Host</Label>
            <Input value={credentials?.host || ""} onChange={(e) => setCredentials({ host: e.target.value })} disabled={isPolling} className="font-mono text-xs" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Port</Label>
            <Input value={credentials?.port || ""} onChange={(e) => setCredentials({ port: e.target.value })} disabled={isPolling} className="font-mono text-xs" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Database</Label>
            <Input value={credentials?.database || ""} onChange={(e) => setCredentials({ database: e.target.value })} disabled={isPolling} className="font-mono text-xs" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Username</Label>
            <Input value={credentials?.username || ""} onChange={(e) => setCredentials({ username: e.target.value })} disabled={isPolling} className="font-mono text-xs" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Password</Label>
            <Input type="password" value={credentials?.password || ""} onChange={(e) => setCredentials({ password: e.target.value })} disabled={isPolling} className="font-mono text-xs" />
          </div>

          <Button 
            className={`w-full mt-4 ${isPolling ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' : 'bg-primary'}`}
            onClick={() => setIsPolling(!isPolling)}
          >
            {isPolling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Stop Polling
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Start Monitoring
              </>
            )}
          </Button>
          
          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            Connects securely to your database and polls internal performance views every 10 seconds to surface the top 20 slowest queries.
          </p>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-8 relative">
        {error && (
          <div className="mb-6 bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg flex items-start gap-3">
            <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
            <div className="text-sm">{error}</div>
          </div>
        )}

        {isPolling && loading && queries.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-50">
            <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
            <p className="text-muted-foreground font-medium animate-pulse">Connecting and analyzing pg_stat_statements...</p>
          </div>
        )}

        {!isPolling && queries.length === 0 && !error ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
            <Activity className="h-16 w-16 mb-4" />
            <h2 className="text-xl font-semibold">Slow Query Monitor</h2>
            <p className="mt-2 text-sm">Enter your credentials and start monitoring to view live slow queries.</p>
          </div>
        ) : (
          <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-8">
              <h1 className="text-2xl font-bold text-foreground">Top Slow Queries</h1>
              {isPolling && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1 rounded-full border border-border">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  Live Updates Active
                </div>
              )}
            </div>

            {queries.map((q, i) => (
              <Card key={i} className="border-border shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 font-mono">
                        Avg: {q.mean_time_ms}ms
                      </Badge>
                      <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/20 font-mono">
                        Max: {q.max_time_ms}ms
                      </Badge>
                      <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20 font-mono">
                        Calls: {q.calls}
                      </Badge>
                      <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-500/20 font-mono">
                        Total: {q.total_time_sec}s
                      </Badge>
                    </div>
                    <Button 
                      size="sm"
                      className="shrink-0 bg-primary/10 text-primary hover:bg-primary/20"
                      onClick={() => {
                        // Store the query in sessionStorage to pick it up on Dashboard
                        sessionStorage.setItem('prefillQuery', q.query);
                        setLocation("/dashboard");
                      }}
                    >
                      <Zap className="h-4 w-4 mr-2" />
                      Optimize Now
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="p-4 bg-muted/30 max-h-64 overflow-y-auto">
                    <pre className="text-xs font-mono text-foreground whitespace-pre-wrap">
                      {q.query}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
