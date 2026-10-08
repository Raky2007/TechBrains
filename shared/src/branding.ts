/**
 * Configurable Game Branding Configuration File
 * Updated with Clean Editorial Human Aesthetics (No dark AI look)
 */

export interface BrandingConfig {
  title: string;
  shortTitle: string;
  subtitle: string;
  eventEdition: string;
  tagline: string;
  description: string;
  colors: {
    bgMain: string;
    bgSecondary: string;
    bgCard: string;
    bgElevated: string;
    textPrimary: string;
    textSecondary: string;
    border: string;
    primaryYellow: string;
    secondaryOrange: string;
    creditBadgeBg: string;
    creditBadgeText: string;
    timerWarning: string;
    error: string;
    success: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    monoFont: string;
  };
  defaultSettings: {
    level1DurationMinutes: number;
    level2DurationMinutes: number;
    initialCredits: number;
    maxLevel2Score: number;
  };
}

export const BRANDING: BrandingConfig = {
  title: "TECHBRAINS",
  shortTitle: "TECHBRAINS",
  subtitle: "LIVE TEAM TECHNICAL CHALLENGE",
  eventEdition: "COLLEGE TECHNICAL EVENT",
  tagline: "Round 1: tell AI from human. Round 2: investigate the case, spend your credits wisely, and submit one final answer.",
  description: "A live two-round team competition. Round 1: AI-or-Human discernment. Round 2: a credit-driven case investigation with text clues, timed media replay, and AI-evaluated final answers.",
  colors: {
    bgMain: "#FFFFFF",
    bgSecondary: "#F5F5F2",
    bgCard: "#FFFFFF",
    bgElevated: "#F5F5F2",
    textPrimary: "#171717",
    textSecondary: "#6B7280",
    border: "#E5E5E5",
    primaryYellow: "#FFC928",
    secondaryOrange: "#FF8A24",
    creditBadgeBg: "#FFF0D6",
    creditBadgeText: "#B34400",
    timerWarning: "#FF8A24",
    error: "#B42318",
    success: "#18794E"
  },
  typography: {
    headingFont: "'Sora', system-ui, -apple-system, sans-serif",
    bodyFont: "'Inter', system-ui, -apple-system, sans-serif",
    monoFont: "'JetBrains Mono', 'Courier New', monospace"
  },
  defaultSettings: {
    level1DurationMinutes: 10,
    level2DurationMinutes: 20,
    initialCredits: 200,
    maxLevel2Score: 20
  }
};
