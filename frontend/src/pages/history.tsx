import { useState } from "react";
import { Clock, Search, Trash2, ChevronRight, Copy, Loader2, Share2, Download, ArrowLeft, Database, ShieldAlert, Cpu } from "lucide-react";
import { format } from "date-fns";
import { format as formatSql } from "sql-formatter";
import { 
  useGetHistory,
  useClearHistory,
  useGetHistoryEntry,
  useDeleteHistoryEntry,
  createShare,
  getGetHistoryQueryKey,
  getGetStatsQueryKey,
  Bottleneck
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";

import { IndexEstimator } from "@/components/IndexEstimator";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import ReactDiffViewer from "react-diff-viewer-continued";
import { HistoryComparisonModal } from "@/components/HistoryComparisonModal";
import type { HistoryEntry } from "@workspace/api-client-react";

export default function HistoryPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<number[]>([]);
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const { theme } = useTheme();
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSharing, setIsSharing] = useState(false);

  const { data: history = [], isLoading } = useGetHistory({ query: { queryKey: getGetHistoryQueryKey() } });
  
  const clearHistory = useClearHistory();
  const deleteEntry = useDeleteHistoryEntry();

  const { data: selectedEntry, isLoading: isEntryLoading } = useGetHistoryEntry(
    selectedEntryId as number, 
    { query: { enabled: !!selectedEntryId, queryKey: ['history-entry', selectedEntryId] } }
  );

  const filteredHistory = history.filter(item => 
    item.original_query.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.optimized_query.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleClearAll = () => {
    if (confirm("Are you sure you want to clear all history?")) {
      clearHistory.mutate(undefined, {
        onSuccess: () => {
          toast({ title: "History cleared" });
          queryClient.invalidateQueries({ queryKey: getGetHistoryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
        }
      });
    }
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteEntry.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Entry deleted" });
        queryClient.invalidateQueries({ queryKey: getGetHistoryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
        if (selectedEntryId === id) setSelectedEntryId(null);
      }
    });
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
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-border bg-card shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Optimization History</h1>
            <p className="text-sm text-muted-foreground mt-1">Review and recover your past query optimizations.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search queries..."
                className="pl-9 bg-background"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant={compareMode ? "default" : "outline"}
                className={compareMode ? "bg-primary text-primary-foreground" : ""}
                onClick={() => {
                  setCompareMode(!compareMode);
                  if (compareMode) setSelectedForCompare([]);
                }}
              >
                Compare Mode {compareMode && `(${selectedForCompare.length}/2)`}
              </Button>
              <Button variant="default" className="bg-red-600 hover:bg-red-700 text-white font-semibold shadow-md shadow-red-900/20 transition-all border-none" onClick={handleClearAll} disabled={history.length === 0 || clearHistory.isPending}>
                {clearHistory.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Clear All
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 bg-background">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full bg-muted/20" />)}
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Clock className="h-12 w-12 mb-4 opacity-20" />
            <h3 className="text-lg font-medium text-foreground">No history found</h3>
            <p className="text-sm mt-1 text-center max-w-sm">
              {searchTerm ? "No queries matched your search." : "Your past optimizations will appear here."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredHistory.map((entry) => (
              <div 
                key={entry.id} 
                className={`group flex items-start gap-4 p-4 rounded-xl border transition-colors cursor-pointer min-w-0 overflow-hidden ${
                  compareMode && selectedForCompare.includes(entry.id)
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/50 hover:bg-card/80"
                }`}
                onClick={() => {
                  if (compareMode) {
                    setSelectedForCompare(prev => {
                      if (prev.includes(entry.id)) return prev.filter(id => id !== entry.id);
                      if (prev.length >= 2) return [prev[1], entry.id];
                      return [...prev, entry.id];
                    });
                  } else {
                    setSelectedEntryId(entry.id);
                  }
                }}
              >
                <div className="shrink-0 flex flex-col items-center justify-center pt-1">
                  <Badge variant="outline" className="bg-background font-mono text-[9px] mb-2 uppercase">
                    {entry.db_type}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground text-center">
                    {format(new Date(entry.created_at), "MMM d")} <br />
                    {format(new Date(entry.created_at), "HH:mm")}
                  </span>
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap sm:flex-nowrap gap-2 mb-2">
                    <span className="text-xs font-bold text-green-700 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20 whitespace-normal break-words shrink-0 max-w-full">
                      {entry.estimated_improvement}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-normal break-words flex-1 min-w-[200px]">
                      {entry.execution_plan_summary}
                    </span>
                  </div>
                  <pre className="text-xs font-mono text-foreground/80 line-clamp-2 overflow-hidden text-ellipsis whitespace-pre-wrap break-all bg-muted/30 p-2 rounded border border-border/50">
                    {entry.original_query}
                  </pre>
                </div>

                <div className="shrink-0 flex items-center justify-center h-full pt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-white hover:bg-red-600 transition-colors shadow-sm" onClick={(e) => handleDelete(e, entry.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <ChevronRight className="h-5 w-5 text-muted-foreground ml-2" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Comparison Action Bar */}
      {compareMode && selectedForCompare.length === 2 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-card border border-border shadow-2xl p-4 rounded-xl flex items-center gap-4 animate-in slide-in-from-bottom-10">
          <div className="text-sm font-medium">2 queries selected</div>
          <Button 
            onClick={() => setShowComparisonModal(true)}
            className="shadow-lg shadow-primary/20"
          >
            Compare Now
          </Button>
        </div>
      )}

      {/* Comparison Modal */}
      {showComparisonModal && selectedForCompare.length === 2 && (
        <HistoryComparisonModal
          id1={selectedForCompare[0]}
          id2={selectedForCompare[1]}
          isOpen={showComparisonModal}
          onClose={() => setShowComparisonModal(false)}
        />
      )}

      <Dialog open={!!selectedEntryId && !compareMode} onOpenChange={(open) => !open && setSelectedEntryId(null)}>
        <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0 bg-background border-border">
          <DialogHeader className="p-4 border-b border-border bg-card shrink-0">
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                Optimization Result
                {selectedEntry && (
                   <Badge variant="outline" className="bg-background font-mono text-[10px] uppercase">
                     {selectedEntry.db_type}
                   </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mr-6">
                {selectedEntry && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      const lines = [];
                      lines.push(`# QuerySage Optimization Report`);
                      lines.push(`**Database Engine:** ${selectedEntry.db_type.toUpperCase()}`);
                      if (selectedEntry.estimated_improvement) lines.push(`**Estimated Improvement:** ${selectedEntry.estimated_improvement}`);
                      if (selectedEntry.query_complexity_score) lines.push(`**Query Complexity Score:** ${selectedEntry.query_complexity_score}/100`);
                      lines.push(`\n## Optimization Strategy`);
                      lines.push(selectedEntry.explanation);
                      
                      if (selectedEntry.bottlenecks && selectedEntry.bottlenecks.length > 0) {
                        lines.push(`\n## Bottlenecks`);
                        selectedEntry.bottlenecks.forEach((b: any) => {
                          lines.push(`- **[${b.severity}] ${b.type}**: ${b.description}`);
                        });
                      }

                      lines.push(`\n## Original Query`);
                      lines.push("```sql\n" + selectedEntry.original_query + "\n```");
                      
                      lines.push(`\n## Optimized Query`);
                      lines.push("```sql\n" + selectedEntry.optimized_query + "\n```");

                      if (selectedEntry.suggested_indexes && selectedEntry.suggested_indexes.length > 0) {
                        lines.push(`\n## Suggested Indexes`);
                        selectedEntry.suggested_indexes.forEach((idx: any) => {
                          if (typeof idx === 'string') {
                            lines.push("```sql\n" + idx + "\n```");
                          } else {
                            lines.push(`- **Reason**: ${idx.reason}\n  \`\`\`sql\n  ${idx.statement}\n  \`\`\``);
                          }
                        });
                      }

                      const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `querysage-report-${selectedEntry.id}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Download className="h-4 w-4 mr-2" /> Download Markdown
                  </Button>
                )}
                {selectedEntry && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    disabled={isSharing}
                    onClick={async () => {
                      if (selectedEntry.share_id) {
                        const url = `${window.location.origin}/share/${selectedEntry.share_id}`;
                        navigator.clipboard.writeText(url);
                        toast({ title: "Copied!", description: "Share link copied to clipboard" });
                        return;
                      }
                      try {
                        setIsSharing(true);
                        const res = await createShare({ history_id: selectedEntry.id });
                        const url = `${window.location.origin}/share/${res.share_id}`;
                        navigator.clipboard.writeText(url);
                        
                        toast({ title: "Link Generated & Copied!", description: "Share link copied to clipboard" });
                        queryClient.invalidateQueries({ queryKey: getGetHistoryQueryKey() });
                      } catch (e) {
                        toast({ title: "Error", description: "Failed to generate share link", variant: "destructive" });
                      } finally {
                        setIsSharing(false);
                      }
                    }}
                  >
                    {isSharing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Share2 className="h-4 w-4 mr-2" />}
                    {selectedEntry.share_id ? "Copy Share Link" : "Share"}
                  </Button>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>
          
          <ScrollArea className="flex-1">
            <div className="p-6">
              {isEntryLoading ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="h-8 w-8 text-primary animate-spin" />
                </div>
              ) : selectedEntry ? (
                <div className="space-y-8">
                  <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-bold text-green-500 flex items-center gap-2">
                        <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30">
                          ~{selectedEntry.estimated_improvement}
                        </Badge>
                      </h2>
                      <p className="text-sm text-green-400/80 mt-1">
                        {selectedEntry.execution_plan_summary}
                      </p>
                    </div>
                    {selectedEntry.query_complexity_score !== undefined && selectedEntry.query_complexity_score > 0 && (
                      <div className="flex flex-col items-end shrink-0">
                        <div className="text-xs font-bold text-green-700 uppercase tracking-wider mb-1">Complexity</div>
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-green-500/20 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-green-500 transition-all duration-500"
                              style={{ width: `${selectedEntry.query_complexity_score}%` }}
                            ></div>
                          </div>
                          <span className="text-sm font-mono font-bold text-green-600">
                            {selectedEntry.query_complexity_score}/100
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {selectedEntry.bottlenecks && selectedEntry.bottlenecks.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-foreground border-b border-border/50 pb-2">Bottlenecks</h3>
                      <div className="grid gap-2">
                        {selectedEntry.bottlenecks.map((b: Bottleneck, i: number) => (
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

                  <div className="rounded-lg border border-border overflow-x-auto max-w-[100vw] sm:max-w-full bg-[#0d1117] p-2 shadow-inner">
                    <div className="min-w-0" style={{ width: "100%", overflowX: "auto" }}>
                      <ReactDiffViewer 
                        oldValue={selectedEntry.original_query} 
                        newValue={(() => {
                          const raw = selectedEntry.optimized_query;
                          if (!raw) return "";
                          try { return formatSql(raw, { language: 'postgresql' }); }
                          catch { return raw; }
                        })()} 
                        splitView={true}
                        useDarkTheme={true}
                        styles={{
                          contentText: {
                            wordBreak: 'break-word',
                          },
                          variables: {
                            dark: {
                              diffViewerBackground: 'transparent',
                              emptyLineBackground: 'transparent',
                              addedBackground: 'rgba(34, 197, 94, 0.15)',
                              addedColor: 'hsl(var(--foreground))',
                              removedBackground: 'rgba(239, 68, 68, 0.15)',
                              removedColor: 'hsl(var(--foreground))',
                              wordAddedBackground: 'rgba(34, 197, 94, 0.4)',
                              wordRemovedBackground: 'rgba(239, 68, 68, 0.4)',
                              addedGutterBackground: 'rgba(34, 197, 94, 0.05)',
                              removedGutterBackground: 'rgba(239, 68, 68, 0.05)',
                              gutterBackground: 'transparent',
                              gutterBackgroundDark: 'transparent',
                            },
                            light: {
                              diffViewerBackground: 'transparent',
                              addedBackground: 'rgba(34, 197, 94, 0.1)',
                              addedColor: 'hsl(var(--foreground))',
                              removedBackground: 'rgba(239, 68, 68, 0.1)',
                              removedColor: 'hsl(var(--foreground))',
                              wordAddedBackground: 'rgba(34, 197, 94, 0.3)',
                              wordRemovedBackground: 'rgba(239, 68, 68, 0.3)',
                              addedGutterBackground: 'rgba(34, 197, 94, 0.05)',
                              removedGutterBackground: 'rgba(239, 68, 68, 0.05)',
                              gutterBackground: 'transparent',
                              gutterBackgroundDark: 'transparent',
                            }
                          },
                          diffContainer: {
                            fontSize: '13px',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                          }
                        }}
                      />
                    </div>
                  </div>

                  {selectedEntry.suggested_indexes && selectedEntry.suggested_indexes.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-foreground border-b border-border/50 pb-2 flex items-center justify-between">
                        Suggested Indexes
                        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => {
                          const allStatements = selectedEntry.suggested_indexes
                            .map((idx: any) => {
                              let parsed = idx;
                              if (typeof idx === 'string' && idx.trim().startsWith('{')) {
                                try { parsed = JSON.parse(idx); } catch (e) {}
                              }
                              return typeof parsed === 'string' ? parsed : parsed.statement;
                            })
                            .join("\n");
                          copyToClipboard(allStatements);
                        }}>
                          <Copy className="h-3 w-3 mr-2" />
                          Copy All
                        </Button>
                      </h3>
                      <div className="bg-muted/50 rounded-lg border border-border overflow-hidden">
                        {selectedEntry.suggested_indexes.map((idx: any, i: number) => {
                          let parsedIdx = idx;
                          if (typeof idx === 'string' && idx.trim().startsWith('{')) {
                            try { parsedIdx = JSON.parse(idx); } catch (e) {}
                          }
                          return (
                            <div key={i} className="flex flex-col group border-b border-border last:border-0 p-3 relative hover:bg-muted/80 transition-colors">
                              <div className="flex justify-between items-start gap-4">
                                <pre className="text-xs font-mono text-yellow-700 whitespace-pre-wrap overflow-x-auto flex-1 bg-background/50 p-2 rounded border border-border/50">
                                  {typeof parsedIdx === 'string' ? parsedIdx : parsedIdx.statement}
                                </pre>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="shrink-0 h-6 w-6 text-muted-foreground hover:text-primary"
                                  onClick={() => copyToClipboard(typeof parsedIdx === 'string' ? parsedIdx : parsedIdx.statement)}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                              {typeof parsedIdx !== 'string' && parsedIdx.reason && (
                                <p className="text-xs text-muted-foreground mt-2">
                                  {parsedIdx.reason}
                                </p>
                              )}
                              <IndexEstimator
                                indexStatement={typeof parsedIdx === 'string' ? parsedIdx : parsedIdx.statement}
                                query={selectedEntry.original_query}
                                dbType={selectedEntry.db_type}
                                // For history, we might not have live DB credentials easily, 
                                // so it will use defaults or heuristic fallback on backend
                              />
                            </div>
                          );
                        })}

                      </div>
                    </div>
                  )}

                </div>
              ) : (
                <div className="text-center text-muted-foreground py-10">Entry not found</div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
