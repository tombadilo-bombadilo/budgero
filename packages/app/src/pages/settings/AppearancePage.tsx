import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Label } from '@shared/ui/label';
import { ThemeSwitch } from '@shared/ui/theme-switch';
import { Separator } from '@shared/ui/separator';
import { Palette, Download, Home, Smartphone } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { usePWA } from '@shared/hooks/usePWA';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import {
  useUiStore,
  type HomePageOption,
  type ClassicFontId,
  type DesktopBudgetLayout,
  type MobileBudgetLayout,
} from '@shared/store/useUiStore';
import { Switch } from '@shared/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { useThemePreset } from '@shared/contexts/ThemePresetContext';
import { BudgetTableSkeleton } from '@features/budget-planning/ui/BudgetTableSkeleton';
import { AccountOrderCard } from '@features/account-management/ui/AccountOrderCard';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';

export default function AppearancePage() {
  const { installApp, installSupport, installInstructions, canInstall } = usePWA();
  const homePage = useUiStore((state) => state.homePage);
  const setHomePage = useUiStore((state) => state.setHomePage);
  const classicFont = useUiStore((state) => state.classicFont);
  const setClassicFont = useUiStore((state) => state.setClassicFont);
  const { themeId } = useThemePreset();
  const desktopBudgetLayout = useUiStore((state) => state.desktopBudgetLayout);
  const setDesktopBudgetLayout = useUiStore((state) => state.setDesktopBudgetLayout);
  const compactMobileLayout = useUiStore((state) => state.compactMobileLayout);
  const setCompactMobileLayout = useUiStore((state) => state.setCompactMobileLayout);
  const mobileBudgetLayout = useUiStore((state) => state.mobileBudgetLayout);
  const setMobileBudgetLayout = useUiStore((state) => state.setMobileBudgetLayout);

  const handleHomePageChange = (value: string) => {
    const page = value as HomePageOption;
    setHomePage(page);
  };

  const classicFontOptions: { id: ClassicFontId; label: string; sampleFamily: string }[] = [
    {
      id: 'fira-code',
      label: 'Fira Code',
      sampleFamily:
        "'Fira Code', 'Fira Code Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    },
    {
      id: 'ibm-plex-mono',
      label: 'IBM Plex Mono',
      sampleFamily:
        "'IBM Plex Mono', 'Fira Code', 'Fira Code Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    },
    {
      id: 'montserrat',
      label: 'Montserrat',
      sampleFamily:
        "'Montserrat', 'Fira Code', 'Fira Code Variable', ui-sans-serif, system-ui, sans-serif",
    },
    {
      id: 'exo-2',
      label: 'Exo 2',
      sampleFamily:
        "'Exo 2', 'Fira Code', 'Fira Code Variable', ui-sans-serif, system-ui, sans-serif",
    },
    {
      id: 'azeret',
      label: 'Azeret Mono',
      sampleFamily:
        "'Azeret Mono', 'Fira Code', 'Fira Code Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    },
    {
      id: 'inter',
      label: 'Inter',
      sampleFamily:
        "'Inter', 'Fira Code', 'Fira Code Variable', ui-sans-serif, system-ui, sans-serif",
    },
    {
      id: 'roboto',
      label: 'Roboto',
      sampleFamily:
        "'Roboto', 'Fira Code', 'Fira Code Variable', ui-sans-serif, system-ui, sans-serif",
    },
    {
      id: 'poppins',
      label: 'Poppins',
      sampleFamily:
        "'Poppins', 'Fira Code', 'Fira Code Variable', ui-sans-serif, system-ui, sans-serif",
    },
  ];

  const fontPreviewFamily = classicFontOptions.find(
    (option) => option.id === classicFont
  )?.sampleFamily;
  return (
    <div className="container max-w-4xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6 sm:space-y-8">
      <SettingsPageHeader
        title="Appearance"
        description="Customize how Budgero looks on your device"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Theme Settings
          </CardTitle>
          <CardDescription>Choose your preferred color scheme</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="theme">Color Theme</Label>
              <p className="text-sm text-muted-foreground">
                Select your preferred theme for the interface
              </p>
            </div>
            <ThemeSwitch />
          </div>

          <Separator />

          {themeId === 'default' ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="classic-font">Budgero Classic font</Label>
                  <p className="text-sm text-muted-foreground">
                    Choose the typeface Budgero Classic should use across the app.
                  </p>
                </div>
                <Select
                  value={classicFont}
                  onValueChange={(value) => setClassicFont(value as ClassicFontId)}
                >
                  <SelectTrigger id="classic-font" className="w-full sm:w-56">
                    <SelectValue placeholder="Choose a font" />
                  </SelectTrigger>
                  <SelectContent>
                    {classicFontOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Preview
                </p>
                <p
                  className="text-base sm:text-lg font-medium"
                  style={fontPreviewFamily ? { fontFamily: fontPreviewFamily } : undefined}
                >
                  Budgero helps budgets breathe easier.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
              Switch to the <span className="font-medium text-foreground">Budgero Classic</span>{' '}
              theme to choose a custom font.
            </div>
          )}
        </CardContent>
      </Card>

      <AccountOrderCard />

      <Card className="hidden md:block">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Home className="h-5 w-5" />
            Budget Table
          </CardTitle>
          <CardDescription>Desktop-only layout preferences for budgeting.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={desktopBudgetLayout}
            onValueChange={(value) => setDesktopBudgetLayout(value as DesktopBudgetLayout)}
            className="space-y-3"
          >
            {(
              [
                {
                  value: 'cards',
                  title: 'Card layout',
                  description: 'Rich cards with goal details and drag-and-drop ordering.',
                },
                {
                  value: 'compact',
                  title: 'Compact cards',
                  description: 'Denser card layout with column summaries for faster scanning.',
                },
                {
                  value: 'table',
                  title: 'Table view',
                  description: 'Spreadsheet-style table with collapsible groups and goal column.',
                },
              ] satisfies { value: DesktopBudgetLayout; title: string; description: string }[]
            ).map((option) => {
              const id = `desktop-budget-layout-${option.value}`;
              return (
                <div
                  key={option.value}
                  className="flex items-start gap-3 rounded-lg border border-border/70 px-3 py-2"
                >
                  <RadioGroupItem value={option.value} id={id} className="mt-1" />
                  <div className="flex-1 space-y-2">
                    <div>
                      <Label htmlFor={id}>{option.title}</Label>
                      <p className="text-sm text-muted-foreground">{option.description}</p>
                    </div>
                    <BudgetTableSkeleton layoutVariant={option.value} />
                  </div>
                </div>
              );
            })}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card className="md:hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Mobile Budget View
          </CardTitle>
          <CardDescription>Mobile-only layout preferences for budgeting.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="compact-mobile-layout">Compact header</Label>
              <p className="text-sm text-muted-foreground">
                Show only month selector and ready to assign in the budget header.
              </p>
            </div>
            <Switch
              id="compact-mobile-layout"
              checked={compactMobileLayout}
              onCheckedChange={setCompactMobileLayout}
            />
          </div>
          <Separator />
          <div className="space-y-3">
            <div className="space-y-0.5">
              <Label>Budget layout</Label>
              <p className="text-sm text-muted-foreground">Choose how categories are displayed.</p>
            </div>
            <RadioGroup
              value={mobileBudgetLayout}
              onValueChange={(value) => setMobileBudgetLayout(value as MobileBudgetLayout)}
              className="space-y-2"
            >
              {(
                [
                  {
                    value: 'cards',
                    title: 'Cards',
                    description: 'Full cards with all details visible.',
                  },
                  {
                    value: 'compact',
                    title: 'Compact cards',
                    description: 'Smaller cards, Activity hidden.',
                  },
                  {
                    value: 'table',
                    title: 'Table',
                    description: 'Minimal rows, tap to expand.',
                  },
                ] satisfies { value: MobileBudgetLayout; title: string; description: string }[]
              ).map((option) => {
                const id = `mobile-budget-layout-${option.value}`;
                return (
                  <div
                    key={option.value}
                    className="flex items-start gap-3 rounded-lg border border-border/70 px-3 py-2"
                  >
                    <RadioGroupItem value={option.value} id={id} className="mt-0.5" />
                    <div className="space-y-0.5">
                      <Label htmlFor={id} className="text-sm">
                        {option.title}
                      </Label>
                      <p className="text-xs text-muted-foreground">{option.description}</p>
                    </div>
                  </div>
                );
              })}
            </RadioGroup>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Home className="h-5 w-5" />
            Default Home
          </CardTitle>
          <CardDescription>Select which page Budgero opens to by default.</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={homePage} onValueChange={handleHomePageChange} className="grid gap-3">
            {(
              [
                {
                  value: 'dashboard',
                  label: 'Dashboard',
                  description: 'At-a-glance overview of balances, spending, and goals.',
                },
                {
                  value: 'planning',
                  label: 'Planning',
                  description: 'Jump straight into the budgeting workspace to assign funds.',
                },
                {
                  value: 'accounts',
                  label: 'All Accounts',
                  description: 'Review account balances and transactions first.',
                },
                {
                  value: 'analytics',
                  label: 'Analytics',
                  description: 'Open the prebuilt reports for deeper insights.',
                },
              ] satisfies { value: HomePageOption; label: string; description: string }[]
            ).map((option) => {
              const id = `home-page-${option.value}`;
              return (
                <div
                  key={option.value}
                  className="flex items-start gap-3 rounded-lg border border-border/70 px-3 py-2"
                >
                  <RadioGroupItem value={option.value} id={id} className="mt-1" />
                  <div className="space-y-1">
                    <Label htmlFor={id}>{option.label}</Label>
                    <p className="text-sm text-muted-foreground">{option.description}</p>
                  </div>
                </div>
              );
            })}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Install App
          </CardTitle>
          <CardDescription>
            Install Budgero for an app-like experience and quick access from your home screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {installSupport === 'native' ? (
            <div className="flex justify-end">
              <Button onClick={installApp} disabled={!canInstall}>
                Install Budgero
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {installSupport === 'manual-ios'
                  ? 'Safari does not allow apps to trigger installation automatically. Follow these steps:'
                  : installSupport === 'manual-firefox'
                    ? 'Firefox does not expose the install prompt on desktop. Use the menu instructions below:'
                    : 'Your browser does not support the automatic install prompt. You can still try manual installation:'}
              </p>
              <pre className="rounded-md border border-border/70 bg-muted/40 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                {installInstructions}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
