import { Link } from "wouter";
import { ArrowRight, DatabaseZap, Terminal, Zap, Shield, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 relative overflow-hidden">
      {/* Animated Blobs Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-primary/20 rounded-full mix-blend-multiply filter blur-[100px] opacity-70 animate-blob"></div>
        <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-cyan-300/20 rounded-full mix-blend-multiply filter blur-[100px] opacity-70 animate-blob animation-delay-2000"></div>
        <div className="absolute top-[20%] left-[20%] w-96 h-96 bg-blue-300/20 rounded-full mix-blend-multiply filter blur-[100px] opacity-70 animate-blob animation-delay-4000"></div>
      </div>
      {/* Navbar */}
      <header className="fixed top-0 w-full border-b border-border/50 bg-background/80 backdrop-blur-md z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DatabaseZap className="h-6 w-6 text-primary" />
            <span className="font-bold text-xl tracking-tight">QuerySage</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/sign-in" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Log In
            </Link>
            <Link href="/sign-up">
              <Button size="sm" className="font-medium">
                Get Started
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 md:pt-40 md:pb-28 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
            <div className="flex-1 text-center lg:text-left">
              <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-6">
                <Terminal className="mr-2 h-4 w-4" />
                LLM-Powered Query Optimizer
              </div>
              <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tighter leading-tight mb-6 text-balance">
                Precision tools for <br className="hidden lg:block" />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">database performance</span>.
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto lg:mx-0 text-balance">
                Analyze bottlenecks, generate optimal indexes, and rewrite complex queries automatically. 
                Like a senior DBA pairing with you in real-time.
              </p>
              <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start">
                <Link href="/sign-up">
                  <Button size="lg" className="h-12 px-8 text-base font-medium group">
                    Start Optimizing
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </Link>
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                  PostgreSQL & MySQL supported
                </div>
              </div>
            </div>

            <div className="flex-1 w-full max-w-2xl lg:max-w-none">
              <div className="rounded-xl overflow-hidden border border-border bg-card shadow-2xl shadow-primary/10">
                <div className="flex items-center px-4 py-3 border-b border-border bg-muted/30">
                  <div className="flex gap-2">
                    <div className="h-3 w-3 rounded-full bg-red-500/80"></div>
                    <div className="h-3 w-3 rounded-full bg-yellow-500/80"></div>
                    <div className="h-3 w-3 rounded-full bg-green-500/80"></div>
                  </div>
                  <div className="mx-auto text-xs font-mono text-muted-foreground">query-sage-analyze.sql</div>
                </div>
                <div className="p-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground font-medium mb-2 flex items-center justify-between">
                      ORIGINAL
                      <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 text-[10px] font-mono">SEQ_SCAN</span>
                    </div>
                    <pre className="text-[11px] font-mono text-muted-foreground overflow-hidden">
{`SELECT u.name, COUNT(o.id)
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.created_at > '2023-01-01'
  AND o.status = 'COMPLETED'
GROUP BY u.name;`}
                    </pre>
                  </div>
                  <div>
                    <div className="text-xs text-primary font-medium mb-2 flex items-center justify-between">
                      OPTIMIZED
                      <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-400 text-[10px] font-mono">92% FASTER</span>
                    </div>
                    <pre className="text-[11px] font-mono text-foreground overflow-hidden">
{`SELECT u.name, COUNT(o.id)
FROM users u
INNER JOIN orders o ON u.id = o.user_id
WHERE u.created_at > '2023-01-01'
  AND o.status = 'COMPLETED'
GROUP BY u.name;`}
                    </pre>
                  </div>
                </div>
                <div className="border-t border-border bg-muted/20 p-4">
                  <div className="text-xs font-mono text-yellow-400 mb-2">/* Suggested Indexes */</div>
                  <pre className="text-[11px] font-mono text-muted-foreground">
{`CREATE INDEX idx_users_created_at ON users(created_at);
CREATE INDEX idx_orders_status_user ON orders(status, user_id);`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 border-y border-border/50 relative z-10">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Precision Analysis Engine</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">Every query is disassembled, evaluated against the schema, and reconstructed for maximum execution speed.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-6 rounded-xl border border-border bg-background">
              <Zap className="h-10 w-10 text-primary mb-4" />
              <h3 className="text-xl font-bold mb-2">Execution Plan Parsing</h3>
              <p className="text-muted-foreground text-sm">
                Paste your EXPLAIN ANALYZE output and QuerySage will identify seq scans, bad join orders, and inefficient subqueries automatically.
              </p>
            </div>
            <div className="p-6 rounded-xl border border-border bg-background">
              <Code2 className="h-10 w-10 text-primary mb-4" />
              <h3 className="text-xl font-bold mb-2">Intelligent Rewrites</h3>
              <p className="text-muted-foreground text-sm">
                Automatically transforms slow subqueries into performant CTEs, fixes implicit casts, and optimizes join conditions.
              </p>
            </div>
            <div className="p-6 rounded-xl border border-border bg-background">
              <Shield className="h-10 w-10 text-primary mb-4" />
              <h3 className="text-xl font-bold mb-2">Index Recommendations</h3>
              <p className="text-muted-foreground text-sm">
                Generates precise DDL statements for missing indexes, including composite indexes and covering indexes based on actual usage patterns.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <div className="flex items-center justify-center gap-2 mb-4">
            <DatabaseZap className="h-5 w-5 text-primary" />
            <span className="font-semibold text-foreground">QuerySage</span>
          </div>
          <p>© {new Date().getFullYear()} QuerySage. Built for precision.</p>
        </div>
      </footer>
    </div>
  );
}
