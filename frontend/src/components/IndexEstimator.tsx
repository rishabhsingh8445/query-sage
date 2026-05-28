import { useState } from "react";
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
      {error && <div className="text-xs text-destructive mb-2">{error}</div>}
      <Button 
        variant="outline" 
        size="sm" 
        className="h-7 text-xs flex items-center gap-2 border-primary/20 hover:bg-primary/5 hover:text-primary"
        onClick={handleEstimate}
        disabled={loading}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
        Estimate Impact Radius & Speedup
      </Button>
    </div>
  );
}
