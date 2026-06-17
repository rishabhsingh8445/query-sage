import { Link, useLocation } from "wouter";
import { useClerk, useUser, OrganizationSwitcher } from "@clerk/react";
import { dark } from "@clerk/themes";
import { 
  LayoutDashboard, 
  Clock, 
  Settings, 
  LogOut, 
  Menu,
  Activity,
  MessageSquare,
  DatabaseZap,
  ArrowRightLeft
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col">
        <div className="flex items-center h-16 px-6 border-b border-border">
          <DatabaseZap className="h-6 w-6 text-primary mr-3" />
          <span className="font-bold text-lg tracking-tight">QuerySage</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
          {navigation.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <Icon
                  className={`mr-3 h-5 w-5 flex-shrink-0 ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center mb-4 px-2">
            <Avatar className="h-9 w-9 mr-3 border border-border">
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback className="bg-primary/20 text-primary">
                {user?.firstName?.charAt(0) || "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium truncate">
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
                  organizationSwitcherTrigger: "w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md text-foreground hover:bg-accent border border-border bg-background",
                  organizationSwitcherPopoverFooter: "hidden",
                }
              }}
            />
          </div>

          <button
            onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" })}
            className="flex items-center w-full px-3 py-2 text-sm font-medium rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="mr-3 h-4 w-4" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
