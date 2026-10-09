import { Trans, useLingui } from '@lingui/react/macro';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Label } from '@shared/ui/label';
import { ThemeSwitch } from '@shared/ui/theme-switch';
import { LanguageSwitch } from '@shared/ui/language-switch';
import { Separator } from '@shared/ui/separator';
import { Palette, Download, Home, Smartphone, Activity, Languages, List } from 'lucide-react';
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
import {
  useDialogBackgroundBlurPreference,
  useHideZeroAmountsPreference,
  useInlineTransactionEntryPreference,
  usePlanningNumberAnimationsPreference,
} from '@shared/hooks/useUserPreferences';

export default function AppearancePage() {
  const { t } = useLingui();

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
  const {
    planningNumberAnimations,
    updatePlanningNumberAnimations,
    isUpdating: isUpdatingPlanningNumberAnimations,
  } = usePlanningNumberAnimationsPreference();
  const {
    dialogBackgroundBlur,
    updateDialogBackgroundBlur,
    isUpdating: isUpdatingDialogBackgroundBlur,
  } = useDialogBackgroundBlurPreference();
  const {
    hideZeroAmounts,
    updateHideZeroAmounts,
    isUpdating: isUpdatingHideZeroAmounts,
  } = useHideZeroAmountsPreference();
  const {
    inlineTransactionEntry,
    updateInlineTransactionEntry,
    isUpdating: isUpdatingInlineTransactionEntry,
  } = useInlineTransactionEntryPreference();

  const handleHomePageChange = (value: string) => {
    const page = value as HomePageOption;
    setHomePage(page);
  };

  const classicFontOptions: { id: ClassicFontId; label: string; sampleFamily: string }[] = [
    {
      id: 'fira-code',
      label: t`Fira Code`,
      sampleFamily:
        "'Fira Code', 'Fira Code Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    },
    {
      id: 'ibm-plex-mono',
      label: t`IBM Plex Mono`,
      sampleFamily:
        "'IBM Plex Mono', 'Fira Code', 'Fira Code Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    },
    {
      id: 'montserrat',
      label: t`Montserrat`,
      sampleFamily:
        "'Montserrat', 'Fira Code', 'Fira Code Variable', ui-sans-serif, system-ui, sans-serif",
    },
    {
      id: 'exo-2',
      label: t`Exo 2`,
      sampleFamily:
        "'Exo 2', 'Fira Code', 'Fira Code Variable', ui-sans-serif, system-ui, sans-serif",
    },
    {
      id: 'azeret',
      label: t`Azeret Mono`,
      sampleFamily:
        "'Azeret Mono', 'Fira Code', 'Fira Code Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    },
    {
      id: 'inter',
      label: t`Inter`,
      sampleFamily:
        "'Inter', 'Fira Code', 'Fira Code Variable', ui-sans-serif, system-ui, sans-serif",
    },
    {
      id: 'roboto',
      label: t`Roboto`,
      sampleFamily:
        "'Roboto', 'Fira Code', 'Fira Code Variable', ui-sans-serif, system-ui, sans-serif",
    },
    {
      id: 'poppins',
      label: t`Poppins`,
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
        title={t`Appearance`}
        description={t`Customize how Budgero looks on your device`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>
              <Languages className="h-5 w-5" />
              Language
            </Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Choose the language Budgero uses on this device</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="language">
                <Trans>Display language</Trans>
              </Label>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Currency and number formatting stay controlled by your budget settings.
                </Trans>
              </p>
            </div>
            <LanguageSwitch id="language" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>
              <Palette className="h-5 w-5" />
              Theme Settings
            </Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Choose your preferred color scheme</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="theme">
                <Trans>Color Theme</Trans>
              </Label>
              <p className="text-sm text-muted-foreground">
                <Trans>Select your preferred theme for the interface</Trans>
              </p>
            </div>
            <ThemeSwitch />
          </div>

          <Separator />

          {themeId === 'default' ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="classic-font">
                    <Trans>Budgero Classic font</Trans>
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    <Trans>Choose the typeface Budgero Classic should use across the app.</Trans>
                  </p>
                </div>
                <Select
                  value={classicFont}
                  onValueChange={(value) => setClassicFont(value as ClassicFontId)}
                >
                  <SelectTrigger id="classic-font" className="w-full sm:w-56">
                    <SelectValue placeholder={t`Choose a font`} />
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
                  <Trans>Preview</Trans>
                </p>
                <p
                  className="text-base sm:text-lg font-medium"
                  style={fontPreviewFamily ? { fontFamily: fontPreviewFamily } : undefined}
                >
                  <Trans>Budgero helps budgets breathe easier.</Trans>
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
              <Trans>
                Switch to the{' '}
                <span className="font-medium text-foreground">
                  <Trans>Budgero Classic</Trans>
                </span>{' '}
                theme to choose a custom font.
              </Trans>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>
              <Activity className="h-5 w-5" />
              Motion
            </Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Control interface animations and visual effects.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="planning-number-animations">
                <Trans>Animate planning amounts</Trans>
              </Label>
              <p className="text-sm text-muted-foreground">
                <Trans>Animate amount changes on the Planning page.</Trans>
              </p>
            </div>
            <Switch
              id="planning-number-animations"
              checked={planningNumberAnimations}
              onCheckedChange={updatePlanningNumberAnimations}
              disabled={isUpdatingPlanningNumberAnimations}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="dialog-background-blur">
                <Trans>Blur behind dialogs</Trans>
              </Label>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Soften the page behind dialogs. Turn this off to keep account names and other
                  context sharp while a dialog is open.
                </Trans>
              </p>
            </div>
            <Switch
              id="dialog-background-blur"
              checked={dialogBackgroundBlur}
              onCheckedChange={updateDialogBackgroundBlur}
              disabled={isUpdatingDialogBackgroundBlur}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>
              <List className="h-5 w-5" />
              Transactions
            </Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Choose how transactions are added and how amounts are shown.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="inline-transaction-entry">
                <Trans>Add transactions</Trans>
              </Label>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  In a dialog, or in an inline row at the top of the account register (desktop).
                </Trans>
              </p>
            </div>
            <Select
              value={inlineTransactionEntry ? 'inline' : 'dialog'}
              onValueChange={(value) => updateInlineTransactionEntry(value === 'inline')}
              disabled={isUpdatingInlineTransactionEntry}
            >
              <SelectTrigger id="inline-transaction-entry" className="w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dialog">
                  <Trans>Dialog</Trans>
                </SelectItem>
                <SelectItem value="inline">
                  <Trans>Inline row</Trans>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="hide-zero-amounts">
                <Trans>Leave zero amounts empty</Trans>
              </Label>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Show an empty Inflow or Outflow cell instead of 0, so the amount that matters
                  stands out.
                </Trans>
              </p>
            </div>
            <Switch
              id="hide-zero-amounts"
              checked={hideZeroAmounts}
              onCheckedChange={updateHideZeroAmounts}
              disabled={isUpdatingHideZeroAmounts}
            />
          </div>
        </CardContent>
      </Card>

      <AccountOrderCard />

      <Card className="hidden md:block">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>
              <Home className="h-5 w-5" />
              Budget Table
            </Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Desktop-only layout preferences for budgeting.</Trans>
          </CardDescription>
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
                  title: t`Card layout`,
                  description: t`Rich cards with goal details and drag-and-drop ordering.`,
                },
                {
                  value: 'compact',
                  title: t`Compact cards`,
                  description: t`Denser card layout with column summaries for faster scanning.`,
                },
                {
                  value: 'table',
                  title: t`Table view`,
                  description: t`Spreadsheet-style table with collapsible groups and goal column.`,
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
            <Trans>
              <Smartphone className="h-5 w-5" />
              Mobile Budget View
            </Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Mobile-only layout preferences for budgeting.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="compact-mobile-layout">
                <Trans>Compact header</Trans>
              </Label>
              <p className="text-sm text-muted-foreground">
                <Trans>Show only month selector and ready to assign in the budget header.</Trans>
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
              <Label>
                <Trans>Budget layout</Trans>
              </Label>
              <p className="text-sm text-muted-foreground">
                <Trans>Choose how categories are displayed.</Trans>
              </p>
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
                    title: t`Cards`,
                    description: t`Full cards with all details visible.`,
                  },
                  {
                    value: 'compact',
                    title: t`Compact cards`,
                    description: t`Smaller cards, Activity hidden.`,
                  },
                  {
                    value: 'table',
                    title: t`Table`,
                    description: t`Minimal rows, tap to expand.`,
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
            <Trans>
              <Home className="h-5 w-5" />
              Default Home
            </Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Select which page Budgero opens to by default.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={homePage} onValueChange={handleHomePageChange} className="grid gap-3">
            {(
              [
                {
                  value: 'dashboard',
                  label: t`Dashboard`,
                  description: t`At-a-glance overview of balances, spending, and goals.`,
                },
                {
                  value: 'planning',
                  label: t`Planning`,
                  description: t`Jump straight into the budgeting workspace to assign funds.`,
                },
                {
                  value: 'accounts',
                  label: t`All Accounts`,
                  description: t`Review account balances and transactions first.`,
                },
                {
                  value: 'analytics',
                  label: t`Analytics`,
                  description: t`Open the prebuilt reports for deeper insights.`,
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
            <Trans>
              <Download className="h-5 w-5" />
              Install App
            </Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Install Budgero for an app-like experience and quick access from your home screen.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {installSupport === 'native' ? (
            <div className="flex justify-end">
              <Button onClick={installApp} disabled={!canInstall}>
                <Trans>Install Budgero</Trans>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {installSupport === 'manual-ios'
                  ? t`Safari does not allow apps to trigger installation automatically. Follow these steps:`
                  : installSupport === 'manual-firefox'
                    ? t`Firefox does not expose the install prompt on desktop. Use the menu instructions below:`
                    : t`Your browser does not support the automatic install prompt. You can still try manual installation:`}
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
