async function deleteTicketWithFallback({
  channel,
  user,
  sendTranscript,
  deleteChannel,
  afterDelete,
}) {
  let transcript;
  try {
    transcript = await sendTranscript(channel, user);
  } catch (error) {
    console.error('Ticket transcript failed; preserving the channel:', error);
    return { deleted: false, transcriptFailed: true, error };
  }

  await deleteChannel();

  try {
    await afterDelete?.(transcript);
  } catch (error) {
    console.error('Post-deletion ticket logging failed:', error);
    return { deleted: true, transcriptFailed: false, postDeleteError: error };
  }

  return { deleted: true, transcriptFailed: false };
}

module.exports = {
  deleteTicketWithFallback,
};
