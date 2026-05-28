import { useState } from "react";
import { ArrowRightLeft, Database, Loader2, Play, Sparkles, Copy, CheckCircle2 } from "lucide-react";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactDiffViewer from "react-diff-viewer-continued";
import { format as formatSql } from "sql-formatter";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";

const DB_OPTIONS = [
  { value: "postgresql", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "sqlserver", label: "SQL Server" },
  { value: "oracle", label: "Oracle" },
  { value: "sqlite", label: "SQLite" },
];

export default function MigratePage() {
  const [sourceDb, setSourceDb] = useState("mysql");
  const [targetDb, setTargetDb] = useState("postgresql");
  const [query, setQuery] = useState("");
  const [isMigrating, setIsMigrating] = useState(false);
  const [result, setResult] = useState<{
    original_query: string;
    migrated_query: string;
    explanation: string;
  } | null>(null);

  const { toast } = useToast();
  const { getToken } = useAuth();
  const { theme } = useTheme();

  const handleMigrate = async () => {
    if (!query || query.trim().length < 5) {
      toast({ title: "Invalid Query", description: "Please enter a valid SQL query.", variant: "destructive" });
      return;
    }
    if (sourceDb === targetDb) {
      toast({ title: "Invalid Selection", description: "Source and Target databases must be different.", variant: "destructive" });
      return;
    }

    setIsMigrating(true);
    setResult(null);

    try {
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const token = await getToken();
      const res = await fetch(`${baseUrl}/api/migrate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ query, source_db: sourceDb, target_db: targetDb })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to migrate query");
      }

      const data = await res.json();
      setResult(data);
      toast({ title: "Migration Successful", description: "Your query has been converted." });
    } catch (err: any) {
      toast({ title: "Migration Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsMigrating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "Copied to clipboard." });
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="p-6 border-b border-border bg-card/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowRightLeft className="h-6 w-6 text-primary" />
            Migration Assistant
          </h1>
          <p className="text-muted-foreground mt-1">Convert SQL syntax seamlessly between different database engines.</p>
        </div>
      </div>

      <ScrollArea className="flex-1 p-6">
        <div className="max-w-5xl mx-auto space-y-6 pb-20">
          
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-4 bg-muted/30 p-4 rounded-xl border border-border">
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Source Engine</label>
              <Select value={sourceDb} onValueChange={setSourceDb}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DB_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden md:flex justify-center mt-6 text-muted-foreground">
              <ArrowRightLeft className="h-5 w-5" />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Target Engine</label>
              <Select value={targetDb} onValueChange={setTargetDb}>
                <SelectTrigger className="bg-background border-primary/50 focus:ring-primary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DB_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold flex justify-between items-center">
              Original SQL Query
            </label>
            <Textarea 
              placeholder="SELECT GETDATE() AS current_date..." 
              className="min-h-[200px] font-mono text-sm bg-muted/30 border-input text-foreground focus-visible:ring-primary/50" 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <Button 
            className="w-full h-12 text-md font-bold shadow-lg shadow-primary/20"
            disabled={isMigrating || !query}
            onClick={handleMigrate}
          >
            {isMigrating ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Translating Syntax...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5 fill-current" />
                Migrate Query
              </>
            )}
          </Button>

          {result && (
            <div className="mt-8 space-y-6 animate-in slide-in-from-bottom-4">
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 flex items-start gap-4">
                <div className="rounded-full bg-green-500/20 p-2 shrink-0">
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                </div>
                <div className="w-full">
                  <h2 className="text-lg font-bold text-green-600 flex items-center gap-2 mb-2">
                    Translation Complete
                    <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/30 uppercase tracking-wider text-[10px]">
                      {sourceDb} ➔ {targetDb}
                    </Badge>
                  </h2>
                  <p className="text-sm text-green-700 leading-relaxed whitespace-pre-wrap">
                    {result.explanation}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-bold text-foreground flex items-center justify-between border-b border-border/50 pb-2">
                  Code Diff
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => copyToClipboard(result.migrated_query)}>
                    <Copy className="h-3 w-3 mr-2" />
                    Copy Migrated SQL
                  </Button>
                </h3>
                <div className="rounded-lg border border-border overflow-x-auto max-w-[100vw] sm:max-w-full bg-[#0d1117] p-2 shadow-inner">
                  <ReactDiffViewer 
                    oldValue={result.original_query} 
                    newValue={(() => {
                      const raw = result.migrated_query;
                      if (!raw) return "";
                      try { return formatSql(raw, { language: 'postgresql' }); }
                      catch { return raw; }
                    })()} 
                    splitView={true}
                    useDarkTheme={true}
                    leftTitle={<span className="text-xs uppercase font-bold text-muted-foreground px-2">{sourceDb}</span>}
                    rightTitle={<span className="text-xs uppercase font-bold text-primary px-2">{targetDb}</span>}
                    styles={{
                      contentText: { wordBreak: 'break-word' },
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
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
