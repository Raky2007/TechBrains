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
  title: "NEXUS // AI INVESTIGATION",
  shortTitle: "NEXUS",
  subtitle: "COLLEGIATE FORENSICS & VERIFICATION CHALLENGE",
  eventEdition: "COLLEGE TECHNICAL EVENT EDITION",
  tagline: "Distinguish synthetic artifice from human truth. Inspect the forensic evidence. State your conclusion.",
  description: "A two-phase competitive forensic event. Phase 1: Real-time artifact discernment. Phase 2: Evidence unlocking with credits and investigative deduction.",
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
    headingFont: "'Space Grotesk', system-ui, -apple-system, sans-serif",
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
