/**
 * Nexus Shared Types and Interfaces
 */
/** Key generation helper for participant client-side conclusion drafts */
export function getConclusionDraftKey(teamId, sessionId) {
    const sessionPart = sessionId ? sessionId : 'active';
    return `techbrains_draft_conclusion_${sessionPart}_${teamId}`;
}
