import { useClerk, useUser } from "@clerk/react";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAppStore } from "@/store/useAppStore";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const clearChat = useAppStore((state) => state.clearChat);

  return (
    <div className="flex h-screen overflow-hidden bg-background selection:bg-primary/30 relative">
      
      {/* Minimal Absolute Header - Only User Avatar / Logout (No Menus) */}
      {user && (
        <header className="absolute top-4 right-4 flex items-center z-50">
          <div className="flex items-center gap-3 bg-black/20 backdrop-blur-md border border-white/5 rounded-full p-1.5 shadow-lg group hover:bg-black/40 transition-all">
             <Avatar className="h-8 w-8 border border-white/10 shadow-sm">
                <AvatarImage src={user.imageUrl} />
                <AvatarFallback className="bg-primary/20 text-primary text-xs">
                  {user.firstName?.charAt(0) || "U"}
                </AvatarFallback>
             </Avatar>
             <button
               onClick={async () => {
                 clearChat();
                 await signOut();
                 window.location.href = "/";
               }}
               className="w-0 overflow-hidden opacity-0 group-hover:w-auto group-hover:opacity-100 group-hover:px-3 text-xs font-medium text-muted-foreground hover:text-red-400 transition-all duration-300 flex items-center whitespace-nowrap"
             >
               <LogOut className="mr-1.5 h-3.5 w-3.5" />
               Sign Out
             </button>
          </div>
        </header>
      )}

      {/* Main content - Takes full 100% width and height */}
      <div className="flex-1 flex flex-col h-full overflow-hidden w-full relative">
        <main className="flex-1 h-full min-h-0 w-full relative">
          {children}
        </main>
      </div>
    </div>
  );
}
