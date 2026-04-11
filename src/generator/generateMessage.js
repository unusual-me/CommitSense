// Weak/vague words that should never appear in a final commit message
const WEAK_WORDS = ['update code', 'changes', 'stuff', 'fix stuff', 'modify', 'change'];

// Soft length limit for commit subject line (Conventional Commits recommendation)
const MAX_SUBJECT_LENGTH = 50;

/**
 * Checks whether a generated message is too vague to be useful.
 * @param {string} message
 * @returns {boolean}
 */
function isMessageWeak(message) {
    const lower = message.toLowerCase();
    return WEAK_WORDS.some(word => lower.includes(word));
}

/**
 * Sanitizes the message: lowercase type, trim trailing spaces.
 * @param {string} message
 * @returns {string}
 */
function sanitize(message) {
    return message.trim().replace(/\s+$/, '');
}

/**
 * Validates the message length and returns a warning string if exceeded.
 * @param {string} message
 * @returns {string | null} Warning text or null if message is OK
 */
function getLengthWarning(message) {
    if (message.length > MAX_SUBJECT_LENGTH) {
        return `Subject line is ${message.length} chars (recommended ≤ ${MAX_SUBJECT_LENGTH}). Consider shortening.`;
    }
    return null;
}

/**
 * Formats and validates a Conventional Commits message from analysis data.
 * Falls back to a safe default if the result is too generic.
 * @param {{ suggestedType: string, suggestedScope: string, suggestedDesc: string, isGeneric: boolean }} analysis
 * @returns {{ message: string, isGeneric: boolean, lengthWarning: string | null }}
 */
function generateMessage(analysis) {
    const { suggestedType, suggestedScope, suggestedDesc, isGeneric } = analysis;

    // Build the raw message
    let message = suggestedType.toLowerCase();
    if (suggestedScope) {
        message += `(${suggestedScope.toLowerCase()})`;
    }
    message += `: ${suggestedDesc}`;

    message = sanitize(message);

    // Safety fallback for weak/empty descriptions
    const finalIsGeneric = isGeneric || !suggestedDesc || isMessageWeak(message);
    if (finalIsGeneric) {
        message = 'chore: update project files';
    }

    const lengthWarning = getLengthWarning(message);

    return { message, isGeneric: finalIsGeneric, lengthWarning };
}

module.exports = { generateMessage };
