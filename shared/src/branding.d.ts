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
export declare const BRANDING: BrandingConfig;
