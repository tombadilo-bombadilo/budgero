import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Shield } from 'lucide-react';

/** Full-screen "no admin access" notice shown by the admin route gates. */
export function AdminAccessRequiredCard() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-500" />
            Admin Access Required
          </CardTitle>
          <CardDescription>You don't have permission to access the admin panel.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Please contact a system administrator if you believe you should have access.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
