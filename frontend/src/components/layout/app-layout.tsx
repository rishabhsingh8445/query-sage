import { Link, useLocation } from "wouter";
import { useClerk, useUser, OrganizationSwitcher } from "@clerk/react";
import { dark } from "@clerk/themes";
import { 
  LayoutDashboard, 
  Clock, 
  LogOut, 
  Menu,
  Activity,
  MessageSquare,
  DatabaseZap,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();

  const navigation = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Visual Builder", href: "/builder", icon: DatabaseZap },
    { name: "Live Monitor", href: "/monitor", icon: Activity },
    { name: "History", href: "/history", icon: Clock },
    { name: "Stats", href: "/stats", icon: Activity },
    { name: "Schema Chat", href: "/schema-chat", icon: MessageSquare },

  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background selection:bg-primary/30">
      
      {/* Absolute Header with Hamburger Menu */}
      <header className="absolute top-0 left-0 right-0 h-16 flex items-center justify-between px-4 z-50 pointer-events-none">
        
        <div className="flex items-center pointer-events-auto">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="hover:bg-white/10 text-muted-foreground hover:text-white transition-colors mr-2">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-card border-r border-border p-0 flex flex-col">
              <div className="flex items-center h-16 px-6 border-b border-border/50">
                <DatabaseZap className="h-6 w-6 text-primary mr-3" />
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">QuerySage</span>
              </div>
              
              <div className="px-4 py-3 border-b border-border/30">
                 <Link href="/schema-chat" className="w-full">
                    <Button className="w-full justify-start bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.1)]">
                      <MessageSquare className="mr-2 h-4 w-4" />
                      New Chat
                    </Button>
                 </Link>
              </div>

              <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">Tools</div>
                {navigation.map((item) => {
                  const isActive = location === item.href;
                  const Icon = item.icon;
                  // Skip schema chat in nav list since it has a big button
                  if (item.name === "Schema Chat") return null;
                  
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                        isActive
                          ? "bg-white/10 text-white"
                          : "text-muted-foreground hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <Icon
                        className={`mr-3 h-4 w-4 flex-shrink-0 ${
                          isActive ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                      {item.name}
                    </Link>
                  );
                })}
              </nav>

              <div className="p-4 border-t border-border/50 bg-black/20">
                <div className="flex items-center mb-4 px-1">
                  <Avatar className="h-9 w-9 mr-3 border-2 border-primary/20 shadow-sm">
                    <AvatarImage src={user?.imageUrl} />
                    <AvatarFallback className="bg-primary/20 text-primary">
                      {user?.firstName?.charAt(0) || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-sm font-medium truncate text-white/90">
                      {user?.fullName || user?.primaryEmailAddress?.emailAddress}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {user?.primaryEmailAddress?.emailAddress}
                    </span>
                  </div>
                </div>
                
                <div className="mb-4">
                  <OrganizationSwitcher 
                    appearance={{
                      baseTheme: dark,
                      elements: {
                        organizationSwitcherTrigger: "w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md text-foreground hover:bg-white/5 border border-border/50 bg-transparent",
                        organizationSwitcherPopoverFooter: "hidden",
                      }
                    }}
                  />
                </div>

                <button
                  onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" })}
                  className="flex items-center w-full px-3 py-2 text-sm font-medium rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors"
                >
                  <LogOut className="mr-3 h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </SheetContent>
          </Sheet>
          
          {/* Logo (visible only when Sidebar is hidden in topbar) */}
          <Link href="/schema-chat" className="flex items-center group cursor-pointer">
             <DatabaseZap className="h-5 w-5 text-primary/80 group-hover:text-primary transition-colors mr-2" />
             <span className="font-semibold text-sm tracking-tight text-white/80 group-hover:text-white transition-colors">QuerySage</span>
          </Link>
        </div>

        <div className="flex items-center pointer-events-auto">
           {/* Right side of header (e.g., user avatar mini) */}
           <Avatar className="h-8 w-8 border border-white/10 cursor-pointer hover:border-primary/50 transition-colors shadow-lg">
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback className="bg-primary/20 text-primary text-xs">
                {user?.firstName?.charAt(0) || "U"}
              </AvatarFallback>
           </Avatar>
        </div>
      </header>

      {/* Main content - Takes full width and height */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
