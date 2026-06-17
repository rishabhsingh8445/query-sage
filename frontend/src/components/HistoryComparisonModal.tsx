import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGetHistoryEntry } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import ReactDiffViewer from "react-diff-viewer-continued";
import { format as formatSql } from "sql-formatter";

import { ArrowRight, Zap } from "lucide-react";
import { useTheme } from "next-themes";

interface HistoryComparisonModalProps {
  id1: number;
  id2: number;
  isOpen: boolean;
  onClose: () => void;
}

export function HistoryComparisonModal({ id1, id2, isOpen, onClose }: HistoryComparisonModalProps) {
  const { theme } = useTheme();
  const { data: entry1, isLoading: loading1 } = useGetHistoryEntry(id1, { query: { queryKey: ['history-entry', id1], enabled: isOpen } });
  const { data: entry2, isLoading: loading2 } = useGetHistoryEntry(id2, { query: { queryKey: ['history-entry', id2], enabled: isOpen } });

  const isLoading = loading1 || loading2;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[95vw] w-[1200px] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden bg-card/95 backdrop-blur">
        <DialogHeader className="p-6 pb-4 border-b border-border/50 bg-background/50">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <Zap className="h-5 w-5 text-yellow-500" />
            Query Comparison
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-w-0">
          <div className="p-6 flex flex-col gap-6 min-w-0">
            {isLoading || !entry1 || !entry2 ? (
              <div className="space-y-4">
                <Skeleton className="h-[200px] w-full bg-muted/20" />
                <Skeleton className="h-[200px] w-full bg-muted/20" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-6">
                  {/* Left Entry */}
                  <div className="space-y-4 border border-border/50 rounded-lg p-4 bg-background">
                    <h3 className="font-semibold text-lg flex items-center justify-between">
                      Version A (ID: {entry1.id})
                      <Badge variant="outline">{entry1.db_type}</Badge>
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="bg-muted/30 p-2 rounded">
                        <span className="text-muted-foreground block text-xs">Complexity</span>
                        <span className="font-mono">{entry1.query_complexity_score}/100</span>
                      </div>
                      <div className="bg-muted/30 p-2 rounded">
                        <span className="text-muted-foreground block text-xs">Improvement</span>
                        <span className="text-green-500 font-medium">{entry1.estimated_improvement}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Entry */}
                  <div className="space-y-4 border border-border/50 rounded-lg p-4 bg-background">
                    <h3 className="font-semibold text-lg flex items-center justify-between">
                      Version B (ID: {entry2.id})
                      <Badge variant="outline">{entry2.db_type}</Badge>
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="bg-muted/30 p-2 rounded">
                        <span className="text-muted-foreground block text-xs">Complexity</span>
                        <span className="font-mono">{entry2.query_complexity_score}/100</span>
                      </div>
                      <div className="bg-muted/30 p-2 rounded">
                        <span className="text-muted-foreground block text-xs">Improvement</span>
                        <span className="text-green-500 font-medium">{entry2.estimated_improvement}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="font-medium flex items-center gap-2">
                    Optimized Query Diff
                    <span className="text-xs font-normal text-muted-foreground">(A vs B)</span>
                  </h4>
                  <div className="rounded-lg border border-border overflow-x-auto max-w-[100vw] sm:max-w-full bg-[#0d1117] p-2 shadow-inner">
                    <div className="min-w-0" style={{ width: "100%", overflowX: "auto" }}>
                      <ReactDiffViewer 
                        oldValue={entry1.optimized_query} 
                        newValue={(() => {
                          const raw = entry2.optimized_query;
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
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
