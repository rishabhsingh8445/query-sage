import { Activity, Database, Zap, FileJson2, PieChart, Brain, ArrowUpRight, AlertTriangle } from "lucide-react";
import { useGetStats, getGetStatsQueryKey } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function StatsPage() {
  const { data: stats, isLoading } = useGetStats({ query: { queryKey: getGetStatsQueryKey() } });
  const { getToken } = useAuth();

  const { data: intelligence, isLoading: intelligenceLoading } = useQuery({
    queryKey: ["query-intelligence"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/intelligence/history`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error("Failed to fetch intelligence");
      return res.json();
    }
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">Usage Statistics & Intelligence</h1>
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Activity className="h-12 w-12 mb-4 opacity-20" />
        <h3 className="text-lg font-medium text-foreground">No data available</h3>
      </div>
    );
  }

  const pgPct = stats.total_optimizations > 0 ? Math.round((stats.postgresql_count / stats.total_optimizations) * 100) : 0;
  const myPct = stats.total_optimizations > 0 ? Math.round((stats.mysql_count / stats.total_optimizations) * 100) : 0;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-6 border-b border-border bg-card shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">Statistics & Intelligence</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of your query optimization patterns and AI insights.</p>
      </div>

      <div className="p-6 overflow-auto space-y-6 max-w-6xl mx-auto w-full">
        {/* Top Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-card border-border shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Optimizations</CardTitle>
              <Zap className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-foreground">{stats.total_optimizations}</div>
              <p className="text-xs text-muted-foreground mt-1">queries analyzed to date</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">PostgreSQL</CardTitle>
              <Database className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-foreground">{stats.postgresql_count}</div>
              <div className="flex items-center mt-2">
                <div className="w-full bg-muted rounded-full h-1.5 mr-2">
                  <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${pgPct}%` }}></div>
                </div>
                <span className="text-xs font-mono text-muted-foreground">{pgPct}%</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">MySQL</CardTitle>
              <Database className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-foreground">{stats.mysql_count}</div>
              <div className="flex items-center mt-2">
                <div className="w-full bg-muted rounded-full h-1.5 mr-2">
                  <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: `${myPct}%` }}></div>
                </div>
                <span className="text-xs font-mono text-muted-foreground">{myPct}%</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* AI Intelligence Section */}
        <Card className="bg-card border-primary/20 shadow-lg border-2">
          <CardHeader className="bg-primary/5 border-b border-primary/10">
            <CardTitle className="flex items-center gap-2 text-xl text-primary">
              <Brain className="h-6 w-6" />
              Query History Intelligence
            </CardTitle>
            <CardDescription>
              AI-driven analysis of your last 30 queries to detect aggregate bottlenecks and common missing indexes.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            {intelligenceLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : intelligence && intelligence.summary !== "No query history available to analyze." ? (
              <div className="space-y-8">
                {/* Health Score & Summary */}
                <div className="flex flex-col md:flex-row gap-6 items-start">
                  <div className="flex flex-col items-center justify-center p-6 bg-muted/30 rounded-xl border border-border/50 min-w-[150px]">
                    <div className="text-5xl font-black text-primary mb-2">
                      {intelligence.overall_health_score}
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Health Score
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                      <Activity className="h-5 w-5 text-muted-foreground" />
                      Executive Summary
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {intelligence.summary}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Common Bottlenecks */}
                  <div>
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-destructive">
                      <AlertTriangle className="h-5 w-5" />
                      Recurring Bottlenecks
                    </h3>
                    <ul className="space-y-3">
                      {intelligence.common_bottlenecks?.map((bn: string, i: number) => (
                        <li key={i} className="bg-destructive/10 text-destructive-foreground p-3 rounded-md text-sm border border-destructive/20">
                          {bn}
                        </li>
                      ))}
                      {!intelligence.common_bottlenecks?.length && (
                        <li className="text-muted-foreground text-sm">No recurring bottlenecks detected. Great job!</li>
                      )}
                    </ul>
                  </div>

                  {/* Suggested Indexes */}
                  <div>
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-emerald-500">
                      <ArrowUpRight className="h-5 w-5" />
                      High-Impact Indexes
                    </h3>
                    <div className="space-y-4">
                      {intelligence.suggested_indexes?.map((idx: any, i: number) => (
                        <div key={i} className="bg-emerald-500/10 p-4 rounded-md border border-emerald-500/20">
                          <div className="flex items-center justify-between mb-2">
                            <Badge variant="outline" className="bg-background text-emerald-600 border-emerald-200">
                              {idx.table}
                            </Badge>
                            <span className="text-xs font-mono bg-background px-2 py-1 rounded text-muted-foreground">
                              {idx.column}
                            </span>
                          </div>
                          <p className="text-sm font-medium mb-1">{idx.reason}</p>
                          <p className="text-xs text-muted-foreground">Impact: {idx.impact}</p>
                        </div>
                      ))}
                      {!intelligence.suggested_indexes?.length && (
                        <p className="text-muted-foreground text-sm">No high-impact indexes suggested at this time.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-10 text-center text-muted-foreground flex flex-col items-center">
                <Brain className="h-10 w-10 mb-2 opacity-20" />
                <p>Not enough query history to generate AI intelligence.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bottlenecks Analysis */}
        <Card className="bg-card border-border shadow-md col-span-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <PieChart className="h-5 w-5 text-primary" />
              Raw Bottlenecks Distribution
            </CardTitle>
            <CardDescription>
              Most frequent performance issues identified across all your queries
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stats.top_bottleneck_types && stats.top_bottleneck_types.length > 0 ? (
              <div className="space-y-6">
                {stats.top_bottleneck_types.map((bn, i) => {
                  const maxCount = stats.top_bottleneck_types[0].count;
                  const pct = Math.max(5, Math.round((bn.count / maxCount) * 100));
                  
                  return (
                    <div key={i} className="flex flex-col gap-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="font-mono text-foreground font-medium">{bn.type}</span>
                        <span className="font-mono text-muted-foreground">{bn.count} occurrences</span>
                      </div>
                      <div className="w-full bg-muted/30 rounded-full h-2 overflow-hidden border border-border/50">
                        <div 
                          className="bg-primary h-full rounded-full transition-all duration-1000 ease-out" 
                          style={{ width: `${pct}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-10 text-center text-muted-foreground flex flex-col items-center">
                <FileJson2 className="h-10 w-10 mb-2 opacity-20" />
                <p>Not enough data to analyze bottlenecks yet.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
