/**
 * Viewport width from which the Planning page shows its desktop layout (the
 * table, with the side panel). Same as the app shell's mobile breakpoint.
 */
export const PLANNING_DESKTOP_BREAKPOINT = 768;

/**
 * Viewport width from which the side panel sits beside the table. Narrower
 * desktop layouts (tablets, unfolded foldables) open it over the table.
 * Keep in sync with the `min-[1020px]:` classes in BudgetingPage.desktop.tsx.
 */
export const PLANNING_PANEL_DOCK_BREAKPOINT = 1020;
