import React from 'react';
import { LogOut } from 'lucide-react';
import { SidebarMenu, SidebarMenuItem, SidebarSeparator } from '@shared/ui/sidebar';
import { Button } from '@shared/ui/button';

interface SidebarFooterContentProps {
  logout: {
    isPending: boolean;
    mutate: () => void;
  };
}

export const SidebarFooterContent = React.memo(function SidebarFooterContent({
  logout,
}: SidebarFooterContentProps) {
  return (
    <>
      <SidebarSeparator />
      <SidebarMenu>
        {/* Plain Button, not SidebarMenuButton: wrapping one in the other
            nests <button> inside <button>, which React (and HTML) forbids. */}
        <SidebarMenuItem className="flex justify-center">
          <Button
            variant="ghost"
            className="text-sm text-destructive hover:text-destructive hover:bg-destructive/10 focus-visible:ring-destructive/40 focus-visible:ring-offset-background flex items-center gap-2"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut className="h-4 w-4" />
            {logout.isPending ? 'Signing out...' : 'Sign out'}
          </Button>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
});
