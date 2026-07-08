import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Input } from '@shared/ui/input';
import { Search } from 'lucide-react';

interface UserSearchCardProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
}

export const UserSearchCard = React.memo(function UserSearchCard({
  searchTerm,
  onSearchChange,
}: UserSearchCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Search Users</CardTitle>
        <CardDescription>Find users by ID, email, or name</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Search by ID, email, or name..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>
      </CardContent>
    </Card>
  );
});
