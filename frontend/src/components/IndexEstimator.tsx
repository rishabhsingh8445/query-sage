import { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Loader2, Activity, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function IndexEstimator({
  indexStatement,
  query,
  dbType,
  dbConfig,
}: {
  indexStatement: string;
  query: string;
  dbType: string;
  dbConfig?: any;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const { getToken } = useAuth();

  const handleEstimate = async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/indexes/estimate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          index_statement: indexStatement,
          query,
          db_type: dbType,
          db_config: dbConfig || {
            host: "localhost",
            port: 5432,
            database: "postgres",
            username: "postgres",
            password: "",
          }
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Estimation failed");
      }
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleEstimate();
  }, [indexStatement, query, dbType]);

  if (loading) {
    return (
      <div className="mt-2.5 flex items-center gap-2 text-xs text-zinc-500 font-mono">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
        <span>Calculating index speedup factor...</span>
      </div>
    );
  }

  if (result) {
    return (
      <div className="mt-3 p-3 bg-card border border-border rounded-md text-sm shadow-sm space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="h-4 w-4 text-primary" />
          <strong className="text-foreground">Impact Estimation Results</strong>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-200 gap-1">
            <Zap className="h-3 w-3" />
            {result.speedup_factor}x Speedup
          </Badge>
          <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-200">
            Affects {result.impact_count} recent queries
          </Badge>
          {result.simulated && (
            <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-200">
              Verified by HypoPG
            </Badge>
          )}
        </div>

        {result.original_cost > 0 && (
          <div className="text-xs text-muted-foreground mt-2 font-mono bg-muted/50 p-2 rounded">
            Cost reduction: {result.original_cost} → {result.new_cost}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2">
      {error && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] text-rose-400 font-mono">Estimation skipped: {error}</div>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-6 text-[10px] w-max px-2.5 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            onClick={handleEstimate}
          >
            Retry Estimation
          </Button>
        </div>
      )}
    </div>
  );
}
