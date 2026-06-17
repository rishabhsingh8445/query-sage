import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle2, ShieldAlert, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import ReactDiffViewer from "react-diff-viewer-continued";
import { format as formatSql } from "sql-formatter";
import { getSharedReport } from "@workspace/api-client-react";
import { Download } from "lucide-react";
import type { Bottleneck } from "@workspace/api-client-react";
import { useTheme } from "next-themes";

export default function SharePage() {
  const { theme } = useTheme();
  const [match, params] = useRoute("/share/:id");
  const shareId = params?.id;

  const { data: report, isLoading, error } = useQuery({
    queryKey: ["share", shareId],
    queryFn: () => getSharedReport(shareId as string),
    enabled: !!shareId,
  });

  if (!match) return null;

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-background text-center">
        <ShieldAlert className="h-16 w-16 text-destructive mb-4" />
        <h1 className="text-2xl font-bold">Report Not Found</h1>
        <p className="text-muted-foreground mt-2">
          The optimization report you are looking for does not exist or has been removed.
        </p>
      </div>
    );
  }

  const getBottleneckColor = (severity: string) => {
    switch (severity) {
      case "HIGH": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "MEDIUM": return "bg-orange-500/10 text-orange-500 border-orange-500/20";
      case "LOW": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      default: return "bg-primary/10 text-primary border-primary/20";
    }
  };

  const downloadMarkdown = () => {
    if (!report) return;
    const lines = [];
    lines.push(`# QuerySage Optimization Report`);
    lines.push(`**Database Engine:** ${report.db_type.toUpperCase()}`);
    if (report.estimated_improvement) lines.push(`**Estimated Improvement:** ${report.estimated_improvement}`);
    if (report.query_complexity_score) lines.push(`**Query Complexity Score:** ${report.query_complexity_score}/100`);
    lines.push(`\n## Optimization Strategy`);
    lines.push(report.explanation);
    
    if (report.bottlenecks && report.bottlenecks.length > 0) {
      lines.push(`\n## Bottlenecks`);
      report.bottlenecks.forEach((b: any) => {
        lines.push(`- **[${b.severity}] ${b.type}**: ${b.description}`);
      });
    }

    lines.push(`\n## Original Query`);
    lines.push("```sql\n" + report.original_query + "\n```");
    
    lines.push(`\n## Optimized Query`);
    lines.push("```sql\n" + report.optimized_query + "\n```");

    if (report.suggested_indexes && report.suggested_indexes.length > 0) {
      lines.push(`\n## Suggested Indexes`);
      report.suggested_indexes.forEach((idx: any) => {
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
    a.download = `querysage-report-${shareId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen w-full flex-col bg-background">
      <div className="border-b border-border bg-card p-4 shadow-sm z-10 flex justify-between items-center">
        <div className="flex items-center gap-2 text-primary font-bold text-lg">
          <Cpu className="h-6 w-6" /> QuerySage Report
        </div>
        <div className="flex items-center gap-4">
          <Badge variant="outline">{report.db_type.toUpperCase()}</Badge>
          <Button variant="outline" size="sm" onClick={downloadMarkdown}>
            <Download className="h-4 w-4 mr-2" /> Download Markdown
          </Button>
        </div>
      </div>
      
      <ScrollArea className="flex-1 min-w-0">
        <div className="mx-auto max-w-5xl p-6 space-y-8 pb-20 min-w-0">
          
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 flex items-start gap-4">
            <div className="rounded-full bg-green-500/20 p-2 shrink-0">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
            </div>
            <div className="w-full">
              <h2 className="text-lg font-bold text-green-600 flex flex-wrap items-center gap-2">
                Optimization Results
                {report.estimated_improvement && (
                  <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/30">
                    ~{report.estimated_improvement}
                  </Badge>
                )}
              </h2>
              <div className="text-sm text-green-700 mt-1">
                {report.execution_plan_summary}
              </div>
            </div>
            {report.query_complexity_score !== undefined && (
              <div className="ml-auto flex flex-col items-end shrink-0">
                <div className="text-xs font-bold text-green-700 uppercase tracking-wider mb-1">Complexity</div>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-2 bg-green-500/20 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-green-500 transition-all duration-500"
                      style={{ width: `${report.query_complexity_score}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-mono font-bold text-green-600">
                    {report.query_complexity_score}/100
                  </span>
                </div>
              </div>
            )}
          </div>

          {report.bottlenecks && report.bottlenecks.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-foreground border-b border-border/50 pb-2">Bottlenecks</h3>
              <div className="grid gap-3">
                {report.bottlenecks.map((b: Bottleneck, i: number) => (
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
                      <p className="text-xs text-muted-foreground mt-1">{b.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-sm font-bold text-foreground border-b border-border/50 pb-2">Query Transformation</h3>
              <div className="rounded-lg border border-border overflow-x-auto max-w-[100vw] sm:max-w-full bg-[#0d1117] p-2 shadow-inner">
                <div className="min-w-0" style={{ width: "100%", overflowX: "auto" }}>
                  <ReactDiffViewer 
                    oldValue={report.original_query} 
                    newValue={(() => {
                      const raw = report.optimized_query;
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
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                      }
                    }}
                  />
                </div>
              </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-bold text-foreground border-b border-border/50 pb-2">Optimization Strategy</h3>
            <div className="text-sm text-muted-foreground leading-relaxed prose prose-invert max-w-none min-h-[60px]">
              <p>{report.explanation}</p>
            </div>
          </div>

          {report.suggested_indexes && report.suggested_indexes.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-foreground border-b border-border/50 pb-2">Suggested Indexes</h3>
              <div className="bg-muted/50 rounded-lg border border-border overflow-hidden">
                {report.suggested_indexes.map((idx: any, i: number) => (
                  <div key={i} className="flex flex-col group border-b border-border last:border-0 p-3">
                    <pre className="text-xs font-mono text-yellow-700 whitespace-pre-wrap bg-background/50 p-2 rounded border border-border/50">
                      {typeof idx === 'string' ? idx : idx.statement}
                    </pre>
                    {typeof idx === 'object' && idx.reason && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground/80">Reason:</span> {idx.reason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </ScrollArea>
    </div>
  );
}
