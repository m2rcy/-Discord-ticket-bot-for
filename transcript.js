function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeMessages(messages) {
  if (!messages) return [];

  // Discord.js collections expose message objects through values().
  if (typeof messages.values === 'function') {
    return [...messages.values()];
  }

  return [...messages];
}

function messagesOnlyTranscriptHtml(messages) {
  const messageBodies = normalizeMessages(messages)
    .filter((message) => {
      if (!message || !message.author || message.author.bot) return false;
      if (typeof message.content !== 'string') return false;
      return message.content.trim().length > 0;
    })
    .sort((first, second) => (first.createdTimestamp || 0) - (second.createdTimestamp || 0))
    .map((message) => {
      const displayName = message.member?.displayName || message.author.globalName || message.author.username;
      const authorName = displayName === message.author.username
        ? displayName
        : `${displayName} (@${message.author.username})`;
      return `<p><strong>${escapeHtml(authorName)}</strong>: ${escapeHtml(message.content).replace(/\r?\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main>${messageBodies}</main></body></html>`;
}

module.exports = { messagesOnlyTranscriptHtml };