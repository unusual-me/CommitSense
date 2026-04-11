/**
 * Generates a Conventional Commits message.
 * @param {Object} analysis - The output of analyzeDiff
 * @returns {string} The formatted commit message
 */
function generateMessage(analysis) {
    const { suggestedType, suggestedScope, suggestedDesc } = analysis;
    
    let message = suggestedType;
    if (suggestedScope) {
        message += `(${suggestedScope})`;
    }
    message += `: ${suggestedDesc}`;
    
    return message;
}

module.exports = { generateMessage };
