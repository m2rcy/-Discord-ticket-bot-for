const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { lookup } = require('node:dns/promises');
const dotenv = require('dotenv');
const { messagesOnlyTranscriptHtml } = require('./transcript');
const { handleReceiptInteraction, isImageAttachment, migrateLegacyReceiptMessage, receiptUploadButton } = require('./receipts');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: false });

// Announcements are handled by the main bot (index.js)

const {
  buyTranslations,
  purchasePaymentMethods,
  purchaseProducts,
} = require('./settings');

const {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const requiredEnvironment = [
  'DISCORD_TOKEN',
  'GUILD_ID',
  'PANEL_CHANNEL_ID',
  'LOG_CHANNEL_ID',
];

const missingEnvironment = requiredEnvironment.filter((variable) => !process.env[variable]);
if (missingEnvironment.length > 0) {
  throw new Error(
    `Missing environment variables: ${missingEnvironment.join(', ')}. Copy .env.example to .env and fill in the real Discord values.`,
  );
}

const supportRoleIds = (process.env.ROLE_SUPPORT || '')
  .split(',')
  .map((roleId) => roleId.trim())
  .filter(Boolean);
const buyRoleIds = (process.env.ROLE_BUY || process.env.ROLE_SUPPORT || '')
  .split(',')
  .map((roleId) => roleId.trim())
  .filter(Boolean);
const warnRoleIds = [process.env.WARN_ROLE_ID, process.env.WARN_ROLE_IDS, process.env.ROLE_WARN]
  .filter(Boolean)
  .flatMap((roleIds) => roleIds.split(','))
  .map((roleId) => roleId.trim())
  .filter(Boolean);
const warningTierRoleIds = [
  process.env.WARN1_ROLE_ID,
  process.env.WARN2_ROLE_ID,
  process.env.WARN_BAN_ROLE_ID,
].map((roleId) => (roleId || '').trim());
const ticketDeleteRoleIds = (process.env.TICKET_DELETE_ROLE_ID || '')
  .split(',')
  .map((roleId) => roleId.trim())
  .filter(Boolean);
const closedTicketCategoryId = (process.env.CLOSED_TICKET_CHANNEL_ID || '').trim();
const ticketBanRoleId = (process.env.TICKET_BAN_ROLE_ID || process.env.ROLE_TICKET_BAN || '').trim();
const resellerRoleIds = [];
const splitRoleIds = (...values) => [...new Set(values
  .filter(Boolean)
  .flatMap((value) => value.split(','))
  .map((roleId) => roleId.trim())
  .filter(Boolean))];
const ticketCloseRoleIds = splitRoleIds(process.env.TICKET_CLOSE_ROLE_ID);
const staffApplicationRoleIds = splitRoleIds(process.env.STAFF_APPLICATION_ROLE_ID, process.env.ROLE_STAFF_AND_MEDIA_APPLICATION_ROLE_ID);
const mediaApplicationRoleIds = splitRoleIds(process.env.MEDIA_APPLICATION_ROLE_ID, process.env.STAFF_APPLICATION_ROLE_ID, process.env.ROLE_STAFF_AND_MEDIA_APPLICATION_ROLE_ID);
const ticketStaffPermissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
];

const ticketTypes = {
  Purchase: {
    label: 'Purchase',
    description: {
      en: 'Use this option to purchase any product.',
    },
    emoji: '🛒',
    roles: buyRoleIds,
    categoryId: (process.env.TICKET_BUY_CATEGORY_ID || '').trim() || undefined,
  },
  'Technical Support': {
    label: 'Technical Support',
    description: {
      en: 'Use this option to get support with our products.',
    },
    emoji: '🛠️',
    fallbackEmoji: '🛠️',
    roles: supportRoleIds,
    categoryId: (process.env.TICKET_SUPPORT_CATEGORY_ID || '').trim() || undefined,
  },
  'Staff Application': {
    label: 'Staff Application',
    description: {
      en: 'Use this option to apply for the staff team.',
    },
    emoji: '📝',
    roles: staffApplicationRoleIds,
    categoryId: (process.env.TICKET_STAFFAPPLICATION_CATEGORY_ID || '').trim() || undefined,
  },
  'Media Application': {
    label: 'Media Application',
    description: {
      en: 'Use this option to apply for the media team.',
    },
    emoji: '🎥',
    roles: mediaApplicationRoleIds,
    categoryId: (process.env.TICKET_MEDIAAPPLICATION_CATEGORY_ID || process.env.TICKET_STAFFAPPLICATION_CATEGORY_ID || '').trim() || undefined,
  },
  Receipt: {
    label: 'Receipt',
    description: {
      en: 'Open a ticket by uploading a receipt image.',
    },
    emoji: '🧾',
    roles: buyRoleIds,
    categoryId: (process.env.TICKET_BUY_CATEGORY_ID || '').trim() || undefined,
  },
};

const supportFormTypeKeys = new Set(['Technical Support', 'Staff Application', 'Media Application', 'Receipt', 'Teknik Destek', 'Dekont']);

function usesSupportForm(typeKey) {
  return supportFormTypeKeys.has(typeKey);
}



function resolveTicketType(value, locale) {
  const normalize = (label) => String(label ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
  const normalizedValue = normalize(value);
  const legacyValues = {
    buy: 'Satın al',
    purchase: 'Satın al',
    support: 'Teknik Destek',
    technicalsupport: 'Teknik Destek',
    staffissues: 'Reseller',
    staffsorunlari: 'Reseller',
    staffapplication: 'Staff Application',
    staffbasvurusu: 'Staff Application',
    mediaapplication: 'Media Application',
  };
  const legacyType = legacyValues[normalizedValue];

  if (ticketTypes[value?.trim()]) return value.trim();
  if (legacyType) return legacyType;

  return Object.entries(ticketTypes).find(([typeKey, type]) => [
    typeKey,
    type.label,
    (translations[locale] || translations.en).typeLabels[typeKey],
    translations.en.typeLabels[typeKey],
  ].some((label) => normalize(label) === normalizedValue))?.[0];
}

const translations = {
  en: {
    typeLabels: {
      Purchase: 'Purchase',
      'Technical Support': 'Technical Support',
      Reseller: 'Reseller',
      'Staff Application': 'Staff Application',
      'Media Application': 'Media Application',
      Receipt: 'Receipt',
      'Satın al': 'Purchase',
      'Teknik Destek': 'Technical Support',
      Dekont: 'Receipt',
    },
    panelPlaceholder: '⬇️ Choose a category!',
    clearSelection: 'Clear selection',
    clearDescription: 'Reset your selection without opening a ticket.',
    selectionCleared: 'Your selection has been cleared.',
    panelTitle: 'Ticket Panel',
    panelDescription:
      '**Before opening a ticket, you can try using the /ask command in text channels to state your issue and see if you can find an answer. If the response you receive does not fully address your question, then go ahead and open a ticket.**\n\n' +
      '📌 Choose a category that matches your needs**\n\n' +
      '**🌐 For detailed information about our products, please visit our [website](https://sysanomaly/product).**',
    close: 'Close ticket',
    delete: 'Delete ticket',
    supportModalTitle: 'Support Request',
    resellerModalTitle: 'Reseller Request',
    staffApplicationModalTitle: 'Staff Application',
    resellerLabel: 'Which product(s)',
    resellerDuration: 'Working duration',
    resellerDurationPrompt: 'How long do you plan to work with us?',
    staffApplicationAge: 'Your age',
    staffApplicationTimezone: 'Your time zone',
    staffApplicationExperience: 'Previous staff experience',
    staffApplicationAvailability: 'Days and hours you are available',
    staffApplicationMotivation: 'Why would you like to join the staff team?',
    issue: 'What is the issue?',
    product: 'Which product?',
    extraDetails: 'Additional details',
    detailsPlaceholder: 'Add any details that could help us resolve your issue.',
    screenshot: 'Error screenshot (optional)',
    evidence: 'Problem screenshot for reseller support (optional)',
    invalidType: 'Invalid ticket type selected.',
    existingTicket: 'You already have an open ticket:',
    ticketCreated: 'Ticket created:',
    ticketIntro: 'your support ticket has been created. The appropriate staff will contact you as soon as possible.',
    supportFormTitle: 'Support Request Details',
    issueField: 'Issue',
    productField: 'Product',
    detailsField: 'Additional details',
    unspecified: 'Not provided',
    requestedBy: 'Requested by:',
    claim: 'Claim ticket',
    claimed: 'Claimed',
    claimedBy: 'Claimed: {staff}',
    claimSuccess: 'You claimed this ticket.',
    claimAlreadyTaken: 'This ticket has already been claimed by {staff}.',
    claimInProgress: 'Another staff member is claiming this ticket right now.',
    claimClosed: 'A closed ticket cannot be claimed.',
    staffOnly: 'Only ticket staff can perform this action.',
    closeRoleOnly: 'You do not have permission to close this ticket.',
    deleteRoleOnly: 'You do not have permission to delete this ticket.',
    ticketBanned: 'You are not allowed to open tickets. Contact the staff team for help.',
    closed: '🔒 Ticket {channel} was closed by {user}.',
    feedbackTitle: 'Rate our staff member',
    feedbackPrompt: 'Your rating matters to us. Please rate your support experience from 1 to 5 stars.',
    feedbackReasonTitle: 'What is the reason for your rating?',
    feedbackReasonLabel: 'Why did you give a low rating?',
    feedbackReasonPlaceholder: 'Tell us about your experience and what we could improve.',
    feedbackReasonRequired: 'Please explain your reason in at least 3 characters. Select a rating button to try again.',
    feedbackThanks: 'Thank you for your feedback.',
    feedbackSaveFailed: 'Your rating could not be saved. Please try again later.',
    feedbackLogTitle: 'Ticket Staff Feedback',
    feedbackScore: 'Rating',
    feedbackReason: 'Reason',
    feedbackTicket: 'Ticket',
    deleteProgress: 'Deleting the ticket and sending the conversation to the log channel...',
    transcriptFailed: 'The transcript could not be sent to the log channel; the ticket was not deleted.',
    unknownError: 'Unknown error',
    ticketPanelSent: 'Ticket panels sent.',
    selectType: 'please select a ticket type:',
  },
};

function localized() {
  return { ...translations.en, ...buyTranslations.en };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
})

// registerProductAnnouncement is disabled here to prevent duplicate interaction collisions with index.js

const TICKET_COOLDOWN_MS = 5 * 60 * 1000;
const claimingTicketIds = new Set();
const dekontSettingsPath = path.resolve(__dirname, 'dekont-settings.json');
const dekontSettings = fs.existsSync(dekontSettingsPath)
  ? JSON.parse(fs.readFileSync(dekontSettingsPath, 'utf8'))
  : { enabled: false };
const applicationSettingsPath = path.resolve(__dirname, 'application-settings.json');
const applicationSettings = fs.existsSync(applicationSettingsPath)
  ? { staffEnabled: true, mediaEnabled: true, ...JSON.parse(fs.readFileSync(applicationSettingsPath, 'utf8')) }
  : { staffEnabled: true, mediaEnabled: true };
const ticketCooldownPath = path.resolve(__dirname, '../ticket-cooldowns.json');
const ticketCooldowns = fs.existsSync(ticketCooldownPath)
  ? JSON.parse(fs.readFileSync(ticketCooldownPath, 'utf8'))
  : {};
const staffFeedbackLogPath = path.resolve(__dirname, '../staff-feedback-logs.json');

function appendStaffFeedbackLog(record) {
  let records = [];
  if (fs.existsSync(staffFeedbackLogPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(staffFeedbackLogPath, 'utf8'));
      if (Array.isArray(parsed)) records = parsed;
    } catch (error) {
      console.warn('Could not read staff-feedback-logs.json; continuing with an empty log:', error.message);
    }
  }

  records.push(record);
  fs.writeFileSync(staffFeedbackLogPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
}

function saveTicketCooldowns() {
  const now = Date.now();
  for (const [userId, expiresAt] of Object.entries(ticketCooldowns)) {
    if (expiresAt <= now) delete ticketCooldowns[userId];
  }
  fs.writeFileSync(ticketCooldownPath, `${JSON.stringify(ticketCooldowns, null, 2)}\n`, 'utf8');
}

function ticketCooldownRemaining(userId) {
  const expiresAt = Number(ticketCooldowns[userId]) || 0;
  if (expiresAt <= Date.now()) {
    delete ticketCooldowns[userId];
    return 0;
  }
  return expiresAt - Date.now();
}

function saveDekontSettings() {
  fs.writeFileSync(dekontSettingsPath, `${JSON.stringify(dekontSettings, null, 2)}\n`, 'utf8');
}

function saveApplicationSettings() {
  fs.writeFileSync(applicationSettingsPath, `${JSON.stringify(applicationSettings, null, 2)}\n`, 'utf8');
}

function isTicketTypeEnabled(typeKey) {
  if (typeKey === 'Staff Application') return applicationSettings.staffEnabled;
  if (typeKey === 'Media Application') return applicationSettings.mediaEnabled;
  return true;
}

const purchaseFlows = new Map();

function createPurchaseFlow(locale, sourceInteraction) {
  const flowId = randomUUID();
  const timeout = setTimeout(() => purchaseFlows.delete(flowId), 30 * 60 * 1000);
  timeout.unref?.();
  purchaseFlows.set(flowId, {
    locale,
    sourceInteraction,
    selectedProducts: new Set(),
    durations: new Map(),
    payment: '',
    details: '',
  });
  return flowId;
}

function panelComponents() {
  const locale = 'en';
  const text = localized();
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ticket_type:${locale}`)
    .setPlaceholder(text.panelPlaceholder)
    .addOptions([
      ...Object.entries(ticketTypes)
        .filter(([value]) => (!['Receipt', 'Dekont'].includes(value) || receiptSettings.enabled) && isTicketTypeEnabled(value))
        .map(([value, type]) => {
        const option = new StringSelectMenuOptionBuilder()
          .setValue(value)
          .setLabel(text.typeLabels[value]);

        if (type.description) {
          option.setDescription(type.description.en);
        }

        if (typeof type.emoji === 'string') {
          option.setEmoji(type.emoji);
        } else if (type.emoji?.id && client.emojis.cache.has(type.emoji.id)) {
          option.setEmoji(type.emoji);
        } else if (type.fallbackEmoji) {
          option.setEmoji(type.fallbackEmoji);
        }

        return option;
      }),
      new StringSelectMenuOptionBuilder()
        .setValue('clear_selection')
        .setLabel(text.clearSelection)
        .setDescription(text.clearDescription)
        .setDefault(false)
        .setEmoji('🧹'),
    ]);

  return [new ActionRowBuilder().addComponents(menu)];
}

const MAX_MODAL_LABEL_LENGTH = 45;

function modalLabel(label) {
  if (label.length <= MAX_MODAL_LABEL_LENGTH) return label;
  return `${label.slice(0, MAX_MODAL_LABEL_LENGTH - 3)}...`;
}

function chatTicketComponents(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`chat_ticket:buy:${userId}`)
        .setLabel('Purchase')
        .setEmoji('🛒')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`chat_ticket:support:${userId}`)
        .setLabel('Technical Support')
        .setEmoji('🛠️')
        .setStyle(ButtonStyle.Secondary),
        ...(applicationSettings.mediaEnabled
          ? [
              new ButtonBuilder()
                .setCustomId(`chat_ticket:media:${userId}`)
                .setLabel('Media Application')
                .setEmoji('🎥')
                .setStyle(ButtonStyle.Secondary),
            ]
          : []),
    ),
  ];
}

function ticketComponents(isClosed = false, locale = 'en', type = '', claimedBy = '') {
  const text = localized();
  const claimLabel = claimedBy === true
    ? text.claimed
    : claimedBy
      ? text.claimedBy.replace('{staff}', claimedBy)
      : text.claim;
  return [
    new ActionRowBuilder().addComponents(
      ...(!isClosed
        ? [
            new ButtonBuilder()
              .setCustomId('ticket_claim')
              .setLabel(claimLabel)
              .setEmoji(claimedBy ? '✅' : '📌')
              .setStyle(claimedBy ? ButtonStyle.Success : ButtonStyle.Primary)
              .setDisabled(Boolean(claimedBy)),
            new ButtonBuilder()
              .setCustomId('ticket_close')
              .setLabel(text.close)
              .setEmoji('🔒')
              .setStyle(ButtonStyle.Secondary),
          ]
        : []),
      new ButtonBuilder()
        .setCustomId('ticket_delete')
        .setLabel(text.delete)
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function ticketData(channel) {
  const topicParts = (channel.topic || '').split('\u200B');
  const visibleTopic = topicParts[0]?.trim() || '';
  const metadataTopic = topicParts[1] || (channel.topic?.startsWith('ticket-owner:') ? channel.topic : '');
  const values = Object.fromEntries(
    metadataTopic
      .split(';')
      .map((value) => value.split(':', 2))
      .filter(([key, value]) => key && value),
  );

  const visibleValues = visibleTopic.match(/^Opening: <@!?([0-9]+)> \| (?:Staff: (?:<@!?([0-9]+)>|Not claimed yet) \| )?Subject: (.*)$/);
  const legacyVisibleValues = visibleTopic.match(/Subject: (.*?) \| Opening: (.*?) \| Staff: (.*?)(?: \| Status: .*)?$/);
  const turkishVisibleValues = visibleTopic.match(/^Konu: (.*?) \| Açan: <@!?([0-9]+)>(?: \| Yetkili: (?:<@!?([0-9]+)>|Henüz alınmadı))?$/);
  const oldTurkishVisibleValues = visibleTopic.match(/Konu: (.*?) \| Acan: (.*?) \| Yetkili: (.*?)(?: \| Durum: .*)?$/);
  const openerMention = visibleTopic.match(/^(?:Opening|Açan): <@!?([0-9]+)>$/);
  const permissionOwner = channel.permissionOverwrites.cache.find(
    (overwrite) => overwrite.type === 1 && overwrite.id !== channel.guild.members.me?.id,
  );

  const ownerId = values['ticket-owner'] || visibleValues?.[1] || turkishVisibleValues?.[2] || openerMention?.[1] || permissionOwner?.id;
  const ownerOverwrite = ownerId ? channel.permissionOverwrites.cache.get(ownerId) : null;
  const ownerName = values['ticket-owner-name'] || legacyVisibleValues?.[2] || oldTurkishVisibleValues?.[2] || (turkishVisibleValues ? `<@${turkishVisibleValues[2]}>` : '') || (openerMention ? `<@${openerMention[1]}>` : 'User');
  const visibleTypeLabel = visibleValues?.[3]
    || turkishVisibleValues?.[1]
    || legacyVisibleValues?.[1]
    || oldTurkishVisibleValues?.[1];
  const locale = 'en';

  return {
    ownerId,
    ownerName,
    staffId: values['ticket-staff'] || visibleValues?.[2] || turkishVisibleValues?.[3],
    status: values['ticket-status'] || (ownerOverwrite?.deny.has(PermissionFlagsBits.ViewChannel) || channel.name?.endsWith('-closed') ? 'closed' : 'open'),
    type: resolveTicketType(safeDecode(values['ticket-type']) || visibleTypeLabel, locale)
      || (channel.name?.toLowerCase().startsWith('purchase-') || channel.name?.startsWith('satın-alım-') ? 'Purchase' : channel.name?.toLowerCase().startsWith('receipt-') || channel.name?.startsWith('dekont-') ? 'Receipt' : 'Technical Support'),
    locale,
    receiptApproved: values['ticket-receipt'] === 'approved',
  };
}

function isTicketChannel(channel) {
  const [visibleTopic = '', metadataTopic = ''] = (channel.topic || '').split('\u200B');
  const normalizedVisibleTopic = visibleTopic.trim();
  const metadata = new Map(
    metadataTopic.split(';').map((entry) => entry.split(':', 2)),
  );
  if (metadata.get('BOT0-ticket') === '1') return true;

  const mention = '<@!?[0-9]+>';
  const labels = [...new Set([
    ...Object.entries(ticketTypes).flatMap(([typeKey, type]) => [
      type.label,
      translations.en.typeLabels[typeKey],
    ]),
    'Staff Sorunları',
    'Staff Issues',
  ])]
    .map((label) => label.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(
    `^(?:Konu: (?:${labels}) \\| Açan: ${mention}(?: \\| Yetkili: (?:${mention}|Henüz alınmadı))?|Konu: (?:${labels}) \\| Acan: [^|]+ \\| Yetkili: [^|]+(?: \\| Durum: .*)?|Opening: ${mention} \\| (?:Staff: (?:${mention}|Not claimed yet) \\| )?Subject: (?:${labels})|Subject: (?:${labels}) \\| Opening: [^|]+ \\| Staff: [^|]+(?: \\| Status: .*)?)`,
    'i',
  ).test(normalizedVisibleTopic);
}

function hasAnyConfiguredRole(interaction, roleIds) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;

  return hasAnyMemberRole(interaction.member?.roles, roleIds);
}

function hasAnyMemberRole(memberRoles, roleIds) {
  if (memberRoles?.cache) {
    return roleIds.some((roleId) => memberRoles.cache.has(roleId));
  }

  return roleIds.some((roleId) => memberRoles?.includes?.(roleId));
}

function isTicketStaff(interaction) {
  const { type } = ticketData(interaction.channel);
  const typeRoles = ticketTypes[type]?.roles || [];
  const eligibleRoles = [...new Set([...supportRoleIds, ...typeRoles])];
  return hasAnyConfiguredRole(interaction, eligibleRoles);
}

function isTicketStaffMember(member, type) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator) ||
      member.permissions?.has(PermissionFlagsBits.ManageChannels)) return true;

  const eligibleRoles = [...new Set([...supportRoleIds, ...(ticketTypes[type]?.roles || [])])];
  return eligibleRoles.some((roleId) => member.roles?.cache?.has(roleId));
}

function canDeleteTicket(interaction) {
  return hasAnyMemberRole(interaction.member?.roles, ticketDeleteRoleIds);
}

function canCloseTicket(interaction) {
  return hasAnyMemberRole(interaction.member?.roles, ticketCloseRoleIds);
}

async function sendTranscript(channel, closedBy) {
  const ticket = ticketData(channel);
  const logChannelId = (process.env.TICKET_LOG_CHANNEL_ID || process.env.LOG_CHANNEL_ID || '').trim();
  const logChannel = await channel.guild.channels.fetch(logChannelId).catch((error) => {
    throw new Error(`Log channel ${logChannelId || '(empty)'} could not be fetched: ${error.message}`);
  });
  if (!logChannel?.isTextBased()) {
    throw new Error(`Log channel ${logChannelId} is not a text-based channel.`);
  }

  const botMember = channel.guild.members.me || await channel.guild.members.fetchMe();
  const missingPermissions = logChannel.permissionsFor(botMember)?.missing([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
  ]) ?? [];
  if (missingPermissions.length > 0) {
    throw new Error(`Missing permissions in log channel ${logChannelId}: ${missingPermissions.join(', ')}`);
  }

  const messages = await channel.messages.fetch({ limit: 100 });
  const messagesOnlyHtml = messagesOnlyTranscriptHtml(messages);
  const closerName = closedBy.globalName && closedBy.globalName !== closedBy.username
    ? `${closedBy.globalName} (@${closedBy.username})`
    : closedBy.username;

  await logChannel.send({
    content: `Ticket \`${channel.name}\` was closed by ${closerName} (<@${closedBy.id}>).`,
    files: [{
      attachment: Buffer.from(messagesOnlyHtml),
      name: `transcript-${channel.name}.html`,
    }],
  });
  await sendTranscriptToOwner(channel, ticket.ownerId, ticket.locale, messagesOnlyHtml);
  return { ticket, transcriptHtml: messagesOnlyHtml };
}

async function sendResellerDeletionLog(channel, user, transcript) {
  return;

  const logChannelId = (process.env.RESELLER_LOG_CHANNEL_ID || process.env.STAFF_ISSUES_LOG_CHANNEL_ID || '').trim();
  if (!logChannelId) {
    throw new Error('RESELLER_LOG_CHANNEL_ID is not configured.');
  }

  const logChannel = await channel.guild.channels.fetch(logChannelId).catch((error) => {
    throw new Error(`Reseller log channel ${logChannelId} could not be fetched: ${error.message}`);
  });
  if (!logChannel?.isTextBased()) {
    throw new Error(`Reseller log channel ${logChannelId} is not a text-based channel.`);
  }

  const botMember = channel.guild.members.me || await channel.guild.members.fetchMe();
  const missingPermissions = logChannel.permissionsFor(botMember)?.missing([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
  ]) ?? [];
  if (missingPermissions.length > 0) {
    throw new Error(`Missing permissions in reseller log channel ${logChannelId}: ${missingPermissions.join(', ')}`);
  }

  const ticket = transcript.ticket;
  await logChannel.send({
    content: [
      `Reseller ticket deleted: \`${channel.name}\``,
      `Opened by: <@${ticket.ownerId}>`,
      `Deleted by: <@${user.id}>`,
    ].join('\n'),
    files: [{
      attachment: Buffer.from(transcript.transcriptHtml),
      name: `reseller-transcript-${channel.name}.html`,
    }],
    allowedMentions: { parse: [] },
  });
}

async function sendTranscriptToOwner(channel, ownerId, locale, transcriptHtml) {
  try {
    const owner = await client.users.fetch(ownerId);
    const transcript = transcriptHtml || messagesOnlyTranscriptHtml(await channel.messages.fetch({ limit: 100 }));

    await owner.send({
      content: `Your ticket \`${channel.name}\` has been closed. Its transcript is attached.`,
      files: [{
        attachment: Buffer.from(transcript),
        name: `transcript-${channel.name}.html`,
      }],
    });
  } catch (error) {
    console.warn(`Could not send ticket transcript DM to ${ownerId}:`, error.message);
  }
}

async function hideClosedTicketFromOwner(ticketChannelId, ownerId) {
  try {
    const channel = await client.channels.fetch(ticketChannelId);
    if (channel?.permissionOverwrites) {
      await channel.permissionOverwrites.edit(ownerId, closedPermissionOverwrite(ownerId));
    }
  } catch (error) {
    console.warn(`Could not hide closed ticket ${ticketChannelId} from ${ownerId}:`, error.message);
  }
}

async function getFeedbackLogChannel() {
  const candidateChannelIds = [
    process.env.STAFF_FEEDBACK_CHANNEL_ID,
    process.env.LOG_CHANNEL_ID,
  ].map((value) => value?.trim()).filter(Boolean);

  // Pick the first configured text channel where the bot can send a message.
  for (const channelId of candidateChannelIds) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !channel.guild) continue;

    const botMember = channel.guild.members.me || await channel.guild.members.fetchMe().catch(() => null);
    if (!botMember) continue;

    const canSendInThread = typeof channel.isThread === 'function' && channel.isThread();
    const sendPermission = canSendInThread
      ? PermissionFlagsBits.SendMessagesInThreads
      : PermissionFlagsBits.SendMessages;

    const missingPermissions = channel.permissionsFor(botMember)?.missing([
      PermissionFlagsBits.ViewChannel,
      sendPermission,
    ]) ?? [];

    if (missingPermissions.length === 0) return channel;
  }

  return null;
}

async function logStaffFeedback({ ownerId, staffId, ticketChannelId, score, reason, locale }) {
  const normalizedScore = Number(score);
  if (!Number.isInteger(normalizedScore) || normalizedScore < 1 || normalizedScore > 5) {
    throw new Error('Invalid rating value.');
  }

  const isSnowflake = (value) => /^\d{16,22}$/.test(String(value || ''));
  const validOwnerId = isSnowflake(ownerId) ? ownerId : null;
  const validStaffId = isSnowflake(staffId) ? staffId : null;
  const validTicketId = isSnowflake(ticketChannelId) ? ticketChannelId : null;

  const text = localized();
  const ownerLabel = validOwnerId ? `<@${validOwnerId}>` : 'Unknown owner';
  const staffLabel = validStaffId ? `<@${validStaffId}>` : 'Unknown staff';
  const allowedUsers = [validOwnerId, validStaffId].filter(Boolean);
  const ticketLabel = validTicketId ? `<#${validTicketId}>` : String(ticketChannelId || 'unknown');
  const scoreLabel = `${'⭐'.repeat(normalizedScore)} (${normalizedScore}/5)`;
  const nowIso = new Date().toISOString();

  appendStaffFeedbackLog({
    createdAt: nowIso,
    locale: 'en',
    ownerId: validOwnerId || String(ownerId || ''),
    staffId: validStaffId || String(staffId || ''),
    ticketChannelId: validTicketId || String(ticketChannelId || ''),
    score: normalizedScore,
    reason: reason || '',
  });

  const logChannel = await getFeedbackLogChannel().catch((error) => {
    console.warn('Rating was saved locally, but the Discord log channel could not be fetched:', error);
    return null;
  });

  if (!logChannel) {
    console.warn('Staff feedback log channel not found; feedback was saved to staff-feedback-logs.json.');
    return;
  }

  const canEmbed = logChannel.permissionsFor(logChannel.guild.members.me)?.has(PermissionFlagsBits.EmbedLinks);

  if (!canEmbed) {
    const lines = [
      `Rated by: ${ownerLabel} | Staff: ${staffLabel}`,
      `${text.feedbackScore}: ${scoreLabel}`,
      `${text.feedbackTicket}: ${ticketLabel}`,
      ...(reason ? [`${text.feedbackReason}: ${reason}`] : []),
    ];

    await logChannel.send({
      content: lines.join('\n'),
      allowedMentions: { users: allowedUsers },
    }).catch((error) => {
      console.warn('Rating was saved locally, but it could not be sent to the Discord log:', error);
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(normalizedScore <= 2 ? 0xe05252 : normalizedScore === 3 ? 0xe0a23b : 0x38a88a)
    .setTitle(text.feedbackLogTitle)
    .addFields(
      { name: text.feedbackScore, value: scoreLabel, inline: true },
      { name: text.feedbackTicket, value: ticketLabel, inline: true },
      ...(reason ? [{ name: text.feedbackReason, value: reason }] : []),
    )
    .setTimestamp();

  await logChannel.send({
    content: `Rated by: ${ownerLabel} | Staff: ${staffLabel}`,
    allowedMentions: { users: allowedUsers },
    embeds: [embed],
  }).catch((error) => {
    console.warn('Rating was saved locally, but it could not be sent to the Discord log:', error);
  });
}

function ticketTopic(ownerId, type, locale = 'en', staffId = null) {
  const text = localized();
  const typeLabel = text.typeLabels[type] || 'Support';
  const metadata = `BOT0-ticket:1;ticket-owner:${ownerId};ticket-type:${encodeURIComponent(type)};ticket-staff:${staffId || ''}`;
  return `Opening: <@${ownerId}> | Staff: ${staffId ? `<@${staffId}>` : 'Not claimed yet'} | Subject: ${typeLabel}\u200B${metadata}`;
}

async function migrateTicketTopics(guild) {
  for (const channel of guild.channels.cache.values()) {
    if (!isTicketChannel(channel)) continue;

    const data = ticketData(channel);
    const owner = await guild.members.fetch(data.ownerId).catch(() => null);
    const claimedStaff = data.staffId
      ? await guild.members.fetch(data.staffId).catch(() => null)
      : null;
    const nextTopic = ticketTopic(data.ownerId, data.type, data.locale, data.staffId);
    const nextName = ticketName(
      data.type,
      { username: owner?.user.username || data.ownerName },
      data.staffId ? claimedStaff?.displayName || 'staff' : '',
      data.locale,
      data.status,
    );
    if (channel.topic !== nextTopic) await channel.setTopic(nextTopic);
    if (channel.name !== nextName) await channel.setName(nextName);
  }
}

async function migrateStaffTicketRolePermissions(guild) {
  const restrictedTypes = new Set(['Staff Application', 'Media Application']);
  const staffPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ];

  for (const channel of guild.channels.cache.values()) {
    if (!isTicketChannel(channel)) continue;

    const { type } = ticketData(channel);
    if (!restrictedTypes.has(type)) continue;

    const allowedRoleIds = new Set(ticketTypes[type].roles);
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (
        overwrite.id === guild.roles.everyone.id ||
        !guild.roles.cache.has(overwrite.id) ||
        allowedRoleIds.has(overwrite.id)
      ) continue;

      await channel.permissionOverwrites.delete(overwrite.id).catch((error) => {
        console.error(`Could not remove role access from ${channel.name}:`, error);
      });
    }

    for (const roleId of allowedRoleIds) {
      await channel.permissionOverwrites.edit(roleId, { allow: staffPermissions }).catch((error) => {
        console.error(`Could not grant staff role access to ${channel.name}:`, error);
      });
    }
  }
}

async function migrateTicketButtons(guild) {
  for (const channel of guild.channels.cache.values()) {
    if (!isTicketChannel(channel)) continue;

    for (const roleId of ticketCloseRoleIds) {
      const overwrite = channel.permissionOverwrites.cache.get(roleId);
      const hasTicketAccess = ticketStaffPermissions.every((permission) => overwrite?.allow.has(permission));
      if (hasTicketAccess) continue;

      await channel.permissionOverwrites.edit(roleId, { allow: ticketStaffPermissions }).catch((error) => {
        console.error(`Could not grant close-role access to ${channel.name}:`, error);
      });
    }

    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!messages) continue;

    const data = ticketData(channel);
    let hasReceiptUploadMessage = messages.some((message) =>
      message.components.some((row) =>
        row.components.some((component) => component.customId === 'receipt_upload'),
      ),
    );

    for (const message of messages.values()) {
      if (message.author.id !== client.user.id || !message.components.length) continue;

      const isClosed = message.components.every((row) =>
        row.components.every((component) => component.customId !== 'ticket_close'),
      ) && message.components.some((row) => row.components.some((component) => component.customId === 'ticket_delete'));
      const hasTicketButtons = message.components.some((row) =>
        row.components.some((component) =>
          ['ticket_claim', 'ticket_close', 'ticket_delete', 'ticket_reopen', 'ticket_talep_et', 'ticket_yeniden_ac'].includes(component.customId),
        ),
      );

      if (await migrateLegacyReceiptMessage(message, isClosed, data, ticketComponents)) continue;
      if (hasTicketButtons) {
        await message.edit({
          components: ticketComponents(
            isClosed,
            data.locale,
            data.type,
            data.staffId
              ? (await guild.members.fetch(data.staffId).catch(() => null))?.displayName || true
              : '',
          ),
        }).catch(() => null);

        if (['Purchase', 'Satın al'].includes(data.type) && !hasReceiptUploadMessage &&
          message.components.some((row) => row.components.some((component) => component.customId === 'ticket_close'))) {
          await channel.send({
            components: [new ActionRowBuilder().addComponents(receiptUploadButton(data.locale))],
          }).catch((error) => console.error(`Could not migrate receipt button in ${channel.name}:`, error));
          hasReceiptUploadMessage = true;
        }
      }
    }
  }
}

async function migratePanel(guild) {
  const panelChannel = await guild.channels.fetch(process.env.PANEL_CHANNEL_ID).catch(() => null);
  if (!panelChannel?.isTextBased()) return;
  await sendPanel(panelChannel).catch((error) => {
    console.error('Panel migration error:', error);
  });
}

function isPanelMessage(message) {
  return message.components.some((row) =>
    row.components.some((component) =>
      component.customId === 'ticket_type' || component.customId?.startsWith('ticket_type:'),
    ),
  );
}

function panelLocale() {
  return 'en';
}

function closedPermissionOverwrite(ownerId) {
  return {
    id: ownerId,
    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
  };
}

function ticketName(type, owner, claimedBy = '', locale = 'en', status = 'open') {
  const prefix = (type === 'Purchase' || type === 'Satın al') ? 'purchase' : (type === 'Receipt' || type === 'Dekont') ? 'receipt' : type === 'Staff Application' ? 'staff-application' : type === 'Media Application' ? 'media-application' : 'support';
  const ownerName = owner?.username || owner?.user?.username || 'user';
  const statusLabel = status === 'closed' ? 'staff' : claimedBy ? 'claimed' : 'waiting';
  return `${prefix}-${ownerName}-${claimedBy || statusLabel}${status === 'closed' ? '-closed' : ''}`
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .slice(0, 90);
}

function serverIconUrl(guild) {
  return guild.iconURL({ size: 256 }) || undefined;
}

function applyPanelBranding(embed, guild) {
  const iconURL = serverIconUrl(guild);
  const brandedEmbed = embed
    .setColor(0xc45cff)
    .setAuthor({
      name: 'SYSAnomaly',
      ...(iconURL ? { iconURL } : {}),
    })
    .setFooter({
      text: ' SYSAnomaly Ticket System ',
      ...(iconURL ? { iconURL } : {}),
    });

  if (iconURL) brandedEmbed.setThumbnail(iconURL);
  return brandedEmbed;
}

function panelEmbed() {
  const text = localized();
  return new EmbedBuilder()
    .setColor(0xc45cff)
    .setAuthor({ name: 'SYSAnomaly' })
    .setFooter({ text: ' SYSAnomaly Ticket System ' })
    .setTitle(text.panelTitle)
    .setDescription(text.panelDescription);
}

function purchasePrompt(locale, flow) {
  const text = localized();
  return `${text.buyProductPrompt}\n${text.selectedProductsCount.replace('{count}', String(flow.selectedProducts.size))}`;
}

function durationPrompt(locale, productIndex, flow) {
  const text = localized(locale);
  const selectedProducts = [...flow.selectedProducts].sort((first, second) => first - second);
  const product = purchaseProducts[productIndex];
  const productLabel = product.labels[locale] || product.value;
  return `${text.productProgress
    .replace('{current}', String(selectedProducts.indexOf(productIndex) + 1))
    .replace('{total}', String(selectedProducts.length))}: ${text.buyDurationPrompt.replace('{product}', productLabel)}`;
}

function purchaseProductActionRow(locale, flowId, flow) {
  const text = localized(locale);
  const allDurationsChosen = flow.selectedProducts.size > 0 &&
    [...flow.selectedProducts].every((productIndex) => flow.durations.has(productIndex));

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_buy_products_continue:${locale}:${flowId}`)
      .setLabel(allDurationsChosen ? text.finish : text.continue)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(flow.selectedProducts.size === 0),
  );
}

function purchasePreviousButton(locale, flowId, target) {
  return new ButtonBuilder()
    .setCustomId(`ticket_buy_previous:${locale}:${flowId}:${target}`)
    .setLabel(localized(locale).previous)
    .setStyle(ButtonStyle.Secondary);
}

function purchaseProductComponents(locale = 'en', flowId) {
  const flow = purchaseFlows.get(flowId);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ticket_buy_product:${locale}:${flowId}`)
    .setPlaceholder(localized(locale).productPlaceholder)
    .setMinValues(0)
    .setMaxValues(Math.min(5, purchaseProducts.length))
    .addOptions(purchaseProducts.map((product, index) => ({
      label: product.labels[locale] || product.value,
      value: String(index),
      default: flow.selectedProducts.has(index),
    })));

  return [
    new ActionRowBuilder().addComponents(menu),
    purchaseProductActionRow(locale, flowId, flow),
  ];
}

function purchaseDurationComponents(locale, flowId, productIndex) {
  const flow = purchaseFlows.get(flowId);
  const selectedProducts = [...flow.selectedProducts].sort((first, second) => first - second);
  const previousProductIndex = selectedProducts[selectedProducts.indexOf(productIndex) - 1];
  const durations = purchaseProducts[productIndex].durations;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ticket_buy_duration:${locale}:${flowId}:${productIndex}`)
    .setPlaceholder(localized(locale).durationPlaceholder)
    .addOptions(durations.map((duration, index) => ({
      label: duration[locale],
      value: String(index),
      default: flow.durations.get(productIndex) === index,
    })));

  return [
    new ActionRowBuilder().addComponents(menu),
    new ActionRowBuilder().addComponents(
      purchasePreviousButton(locale, flowId, previousProductIndex ?? 'products'),
    ),
  ];
}

async function purchaseAnswers(flow, locale) {
  const products = await Promise.all([...flow.selectedProducts]
    .sort((first, second) => first - second)
    .map((productIndex) => {
      const product = purchaseProducts[productIndex];
      const duration = product.durations[flow.durations.get(productIndex)];
      return {
        product: product.labels[locale] || product.value,
        quantity: duration[locale],
      };
    }));

  return {
    products,
    payment: flow.payment,
    details: flow.details,
  };
}

function purchasePaymentComponents(locale, flowId) {
  const flow = purchaseFlows.get(flowId);
  const text = localized(locale);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ticket_buy_payment:${locale}:${flowId}`)
    .setPlaceholder(localized(locale).paymentPlaceholder)
    .addOptions(purchasePaymentMethods.map((method) => ({
      label: method[locale],
      value: method.value,
      default: method[locale] === flow.payment,
    })));

  const lastProductIndex = [...flow.selectedProducts].sort((first, second) => first - second).at(-1);
  return [
    new ActionRowBuilder().addComponents(menu),
    new ActionRowBuilder().addComponents(
      purchasePreviousButton(locale, flowId, lastProductIndex),
      new ButtonBuilder()
        .setCustomId(`ticket_buy_payment_continue:${locale}:${flowId}`)
        .setLabel(text.continue)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!flow.payment),
    ),
  ];
}

function purchaseDetailsModal(locale, flowId) {
  const text = localized(locale);
  return new ModalBuilder()
    .setCustomId(`ticket_buy_details:${locale}:${flowId}`)
    .setTitle(text.purchaseDetailsModalTitle || 'Order Details')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(text.purchaseDetailsLabel || 'Order Details / Specific Requests')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('details')
            .setPlaceholder(text.purchaseDetailsPlaceholder || 'Enter any additional details or requirements...')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(false),
        ),
    );
}

function dekontTicketModal(locale = 'en') {
  return new ModalBuilder()
    .setCustomId(`ticket_dekont_form:${locale}`)
    .setTitle('Upload receipt image')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Receipt image')
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId('dekont_image')
            .setMinValues(1)
            .setMaxValues(1)
            .setRequired(true),
        ),
    );
}

function supportTicketModal(locale = 'en', typeKey = 'Technical Support') {
  const text = localized(locale);
  const isReseller = false;
  const isStaffApplication = ['Staff Application', 'Media Application'].includes(typeKey);
  const fields = isReseller
    ? [
        { id: 'reseller', label: text.resellerLabel, style: TextInputStyle.Short, maxLength: 100 },
        { id: 'duration', label: text.resellerDuration, placeholder: text.resellerDurationPrompt, style: TextInputStyle.Short, maxLength: 100 },
        { id: 'details', label: text.extraDetails, style: TextInputStyle.Paragraph, maxLength: 1000 },
      ]
    : isStaffApplication
      ? [
          { id: 'age', label: text.staffApplicationAge, style: TextInputStyle.Short, maxLength: 20 },
          { id: 'timezone', label: text.staffApplicationTimezone, style: TextInputStyle.Short, maxLength: 50 },
          { id: 'experience', label: text.staffApplicationExperience, style: TextInputStyle.Paragraph, maxLength: 1000 },
          { id: 'availability', label: text.staffApplicationAvailability, style: TextInputStyle.Paragraph, maxLength: 500 },
          { id: 'motivation', label: text.staffApplicationMotivation, style: TextInputStyle.Paragraph, maxLength: 1000 },
        ]
      : [
          { id: 'issue', label: text.issue, style: TextInputStyle.Paragraph, maxLength: 1000 },
          { id: 'product', label: text.product, style: TextInputStyle.Short, maxLength: 100 },
          { id: 'details', label: text.extraDetails, style: TextInputStyle.Paragraph, maxLength: 1000, required: false, placeholder: text.detailsPlaceholder },
        ];

  const modal = new ModalBuilder()
    .setCustomId(`ticket_support_form:${locale}:${encodeURIComponent(typeKey)}`)
    .setTitle(isReseller
      ? text.resellerModalTitle
      : isStaffApplication ? text.staffApplicationModalTitle : text.supportModalTitle)
    .addLabelComponents(...fields.map((field) => {
      const input = new TextInputBuilder()
        .setCustomId(field.id)
        .setStyle(field.style)
        .setMaxLength(field.maxLength)
        .setRequired(field.required !== false);

      if (field.placeholder) input.setPlaceholder(field.placeholder);

      return new LabelBuilder()
        .setLabel(modalLabel(field.label))
        .setTextInputComponent(input);
    }));

  if (!isStaffApplication) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel(isReseller ? text.evidence : text.screenshot)
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId('screenshot')
            .setMaxValues(1)
            .setRequired(false),
        ),
    );
  }

  return modal;
}

async function createTicket(interaction, typeKey, formAnswers = null, locale = 'en') {
  const type = ticketTypes[typeKey];
  const text = localized(locale);
  const guild = interaction.guild;
  let cooldownReservation = 0;
  let ticketChannelCreated = false;
  await interaction.deferReply({ ephemeral: true });

  try {
    if (!isTicketTypeEnabled(typeKey)) {
      await interaction.editReply('This application type is currently unavailable.');
      return false;
    }

    const existing = guild.channels.cache.find((channel) => {
      if (!isTicketChannel(channel)) return false;
      const data = ticketData(channel);
      return data.ownerId === interaction.user.id && data.status === 'open' && Boolean(data.staffId);
    });

    if (existing) {
      await interaction.editReply(`${text.existingTicket} ${existing}`);
      return false;
    }

    const isStaffOrAdmin = Boolean(
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ||
      hasAnyConfiguredRole(interaction, [...supportRoleIds, ...buyRoleIds, ...ticketDeleteRoleIds, ...ticketCloseRoleIds])
    );

    if (!isStaffOrAdmin && ticketBanRoleId && interaction.member?.roles.cache.has(ticketBanRoleId)) {
      await interaction.editReply(text.ticketBanned);
      return false;
    }

    const hasSupportRole = hasAnyConfiguredRole(interaction, supportRoleIds);
    const cooldownRemaining = hasSupportRole ? 0 : ticketCooldownRemaining(interaction.user.id);
    if (cooldownRemaining > 0) {
      const secondsRemaining = Math.ceil(cooldownRemaining / 1000);
      await interaction.editReply(`You can open only one ticket every 5 minutes. Please wait ${secondsRemaining} seconds before trying again.`);
      return false;
    }

    const permissionOverwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ];

    for (const roleId of new Set([...type.roles, ...ticketCloseRoleIds])) {
      permissionOverwrites.push({
        id: roleId,
        allow: ticketStaffPermissions,
      });
    }

    if (!hasSupportRole) {
      cooldownReservation = Date.now() + TICKET_COOLDOWN_MS;
      ticketCooldowns[interaction.user.id] = cooldownReservation;
      saveTicketCooldowns();
    }
    const panelChannel = await guild.channels.fetch(process.env.PANEL_CHANNEL_ID);
    const categoryId = type.categoryId || process.env.TICKET_CATEGORY_ID || panelChannel.parentId || undefined;
    const ticketChannel = await guild.channels.create({
      name: ticketName(typeKey, interaction.user),
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: ticketTopic(interaction.user.id, typeKey, locale),
      permissionOverwrites,
    });
    ticketChannelCreated = true;

    const roleMentions = type.roles.map((roleId) => `<@&${roleId}>`).join(' ');
    const embed = applyPanelBranding(new EmbedBuilder(), interaction.guild)
      .setTitle(`${type.emoji} ${text.typeLabels[typeKey]}`)
      .setDescription(`Hello ${interaction.user}, ${text.ticketIntro}`)
      .setTimestamp();

    const screenshots = (formAnswers?.screenshots || []).map((attachment) => ({
      attachment: attachment.url,
      name: attachment.name,
    }));
    const iconURL = serverIconUrl(interaction.guild);

    if (formAnswers) {
      embed
        .addFields(usesSupportForm(typeKey)
          ? formAnswers.fields || [
              { name: text.issueField, value: formAnswers.issue },
              { name: text.productField, value: formAnswers.product },
              { name: text.detailsField, value: formAnswers.details || text.unspecified },
            ]
          : [
              {
                name: text.productField,
                value: formAnswers.products
                  .map(({ product, quantity }) => `${product}: ${quantity}`)
                  .join('\n')
                  .slice(0, 1024),
              },
              { name: text.paymentField || 'Payment Method', value: formAnswers.payment },
              { name: text.detailsField, value: formAnswers.details || text.unspecified },
            ])
        .setFooter({
          text: `${text.requestedBy} ${interaction.user.username}`,
          ...(iconURL ? { iconURL } : {}),
        });
    }

    const ticketMessage = await ticketChannel.send({
      content: `${interaction.user} ${roleMentions}`.trim(),
      embeds: [embed],
      components: ticketComponents(false, locale, typeKey),
      files: screenshots,
      allowedMentions: { users: [interaction.user.id], roles: type.roles },
    });

    if (typeKey === 'Purchase' || typeKey === 'Satın al') {
      await ticketChannel.send({
        components: [new ActionRowBuilder().addComponents(receiptUploadButton(locale))],
      });
    }

    if (formAnswers) {
      try {
        await ticketMessage.pin();
      } catch (error) {
        console.error('Could not pin ticket message:', error);
        await interaction.editReply(`Ticket created: ${ticketChannel}\nThe ticket message could not be pinned. Give the bot the Manage Messages permission in ticket channels. Details: ${error.message}`);
        return false;
      }
    }

    await interaction.editReply(`${text.ticketCreated} ${ticketChannel}`);
    return true;
  } catch (error) {
    if (cooldownReservation && !ticketChannelCreated && ticketCooldowns[interaction.user.id] === cooldownReservation) {
      delete ticketCooldowns[interaction.user.id];
      saveTicketCooldowns();
    }
    console.error('Ticket creation error:', error);
    await interaction.editReply(`Ticket could not be completed: ${error.message}`);
    return false;
  }
}

async function sendPanel(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const panelMessages = messages.filter(
    (message) => message.author.id === client.user.id && isPanelMessage(message),
  );

  const panelMessage = panelMessages.find((message) => panelLocale(message) === 'en') || panelMessages.first();
  if (!panelMessage) {
    await channel.send({ embeds: [panelEmbed()], components: panelComponents() });
    return;
  }

  const locale = panelLocale(panelMessage);
  await panelMessage.edit({ embeds: [panelEmbed()], components: panelComponents(locale) });
  await Promise.all(panelMessages
    .filter((message) => message.id !== panelMessage.id)
    .map((message) => message.delete().catch(() => null)));
}

async function autoCloseInactiveTickets() {
  try {
    const guildId = process.env.GUILD_ID;
    if (!guildId) return;
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) return;

    const now = Date.now();
    const INACTIVE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours

    for (const [, channel] of channels) {
      if (!channel || !channel.isTextBased() || !isTicketChannel(channel)) continue;

      const data = ticketData(channel);
      if (data.status === 'closed' || channel.name?.endsWith('-closed')) continue;

      const messages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
      if (!messages || messages.size === 0) continue;

      const lastMessage = messages.first();
      const timeSinceLastMessage = now - lastMessage.createdTimestamp;

      if (timeSinceLastMessage >= INACTIVE_LIMIT_MS) {
        console.log(`[Auto-Close] Ticket ${channel.name} (${channel.id}) has been inactive for 24+ hours. Closing...`);

        const embed = new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle('⏰ ticket timeout / Inactive Ticket')
          .setDescription('\n\n' +
            'This ticket has been automatically closed due to 24 hours of inactivity.'
          )
          .setTimestamp();

        await channel.send({
          embeds: [embed],
          components: ticketComponents(true, data.locale, data.type),
        }).catch(() => {});

        try {
          if (data.ownerId) {
            await channel.permissionOverwrites.edit(data.ownerId, !data.staffId
              ? {
                  id: data.ownerId,
                  allow: [PermissionFlagsBits.ViewChannel],
                  deny: [PermissionFlagsBits.SendMessages],
                }
              : closedPermissionOverwrite(data.ownerId)).catch(() => {});
          }

          if (closedTicketCategoryId) {
            await channel.setParent(closedTicketCategoryId).catch(() => {});
          }

          const owner = data.ownerId ? await guild.members.fetch(data.ownerId).catch(() => null) : null;
          await channel.setName(ticketName(
            data.type,
            owner || { username: data.ownerName },
            'auto-closed',
            data.locale,
            'closed',
          )).catch(() => {});

          await channel.setTopic(ticketTopic(data.ownerId, data.type, data.locale, data.staffId)).catch(() => {});
        } catch (err) {
          console.error(`[Auto-Close] Error updating channel state for ${channel.id}:`, err);
        }
      }
    }
  } catch (error) {
    console.error('[Auto-Close] Error in autoCloseInactiveTickets loop:', error);
  }
}

client.once('ready', async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const ticketCommands = [
    {
      name: 'open',
      description: 'Open the ticket selection menu.',
    },
    {
      name: 'ticket-panel',
      description: 'Send the ticket selection panel to this channel.',
      default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    },
    {
      name: 'receipt-toggle',
      description: 'Enable or disable the receipt option in the ticket panel.',
      default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    },
    {
      name: 'staff-application-toggle',
      description: 'Enable or disable staff applications in the ticket panel.',
      default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    },
    {
      name: 'media-application-toggle',
      description: 'Enable or disable media applications in the ticket panel.',
      default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    },
    {
      name: 'ticket-ban',
      description: 'Prevent a member from opening tickets.',
      default_member_permissions: PermissionFlagsBits.Administrator.toString(),
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'user-id',
          description: 'The Discord ID of the member to restrict.',
          required: true,
          min_length: 17,
          max_length: 20,
        },
      ],
    },
    {
      name: 'ticket-unban',
      description: 'Allow a member to open tickets again.',
      default_member_permissions: PermissionFlagsBits.Administrator.toString(),
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'user-id',
          description: 'The Discord ID of the member to allow.',
          required: true,
          min_length: 17,
          max_length: 20,
        },
      ],
    },
  ];
  // Visible to anyone allowed to use application commands; the handlers enforce staff-only access.
  for (const command of ticketCommands) {
    command.default_member_permissions = PermissionFlagsBits.UseApplicationCommands.toString();
  }
  // Keep commands registered by the other bots sharing this application.
  const ticketCommandNames = new Set(ticketCommands.map((command) => command.name));
  const existingCommands = await guild.commands.fetch();
  const foreignCommands = [...existingCommands.values()]
    .filter((command) => !ticketCommandNames.has(command.name))
    .map((command) => command.toJSON());
  await guild.commands.set([...ticketCommands, ...foreignCommands]);
  await migratePanel(guild);
  await migrateTicketTopics(guild);
  await migrateStaffTicketRolePermissions(guild);
  await migrateTicketButtons(guild);
  // Check for inactive tickets every 15 minutes and once on startup
  setInterval(autoCloseInactiveTickets, 15 * 60 * 1000);
  setTimeout(autoCloseInactiveTickets, 30 * 1000);

  console.log(`${client.user.tag} is online.`);
});

async function moveTicketToPurchase(channel, data, user) {
  try {
    const targetCategoryId = (process.env.TICKET_BUY_CATEGORY_ID || '').trim();
    if (targetCategoryId) {
      await channel.setParent(targetCategoryId, { lockPermissions: false }).catch((e) => console.error('Error setting category:', e));
    }

    for (const roleId of new Set([...buyRoleIds, ...ticketCloseRoleIds])) {
      await channel.permissionOverwrites.edit(roleId, ticketStaffPermissions).catch(() => null);
    }

    await channel.setTopic(ticketTopic(data.ownerId, 'Purchase', data.locale, data.staffId)).catch(() => null);

    const owner = data.ownerId ? await channel.guild.members.fetch(data.ownerId).catch(() => null) : null;
    const claimedStaff = data.staffId ? await channel.guild.members.fetch(data.staffId).catch(() => null) : null;
    const staffName = data.staffId ? claimedStaff?.displayName || 'staff' : '';
    await channel.setName(ticketName('Purchase', owner || { username: data.ownerName }, staffName, data.locale, data.status)).catch(() => null);

    const moveEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('🛒 Ticket Moved to Purchase')
      .setDescription(`This ticket has been moved to the **Purchase** category by ${user}.\nYou can submit your payment receipt using the button below.`)
      .setTimestamp();

    await channel.send({
      embeds: [moveEmbed],
      components: [new ActionRowBuilder().addComponents(receiptUploadButton(data.locale))],
    }).catch(() => null);
  } catch (error) {
    console.error('Error in moveTicketToPurchase:', error);
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
  if (await handleReceiptInteraction(interaction, { client, ticketData, isTicketChannel, moveTicketToPurchase })) return;

  if (interaction.isChatInputCommand() && interaction.commandName === 'open') {
    const embed = new EmbedBuilder()
      .setColor(0xc45cff)
      .setDescription(`${interaction.user}, please select a ticket type:`);

    await interaction.reply({
      embeds: [embed],
      components: chatTicketComponents(interaction.user.id),
      ephemeral: true,
    });
    return;
  }

  if (
    interaction.isChatInputCommand()
    && ['ticket-ban', 'ticket-unban'].includes(interaction.commandName)
  ) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Only administrators can use this command.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      if (!ticketBanRoleId) {
        throw new Error('Configure TICKET_BAN_ROLE_ID in the .env file.');
      }

      const targetId = interaction.options.getString('user-id', true).trim();
      if (!/^\d{17,20}$/.test(targetId)) {
        throw new Error('Enter a valid Discord user ID.');
      }

      const targetMember = await interaction.guild.members.fetch(targetId);
      const role = await interaction.guild.roles.fetch(ticketBanRoleId);
      if (!role) {
        throw new Error(`Ticket restriction role not found in the server: ${ticketBanRoleId}`);
      }

      const botMember = interaction.guild.members.me;
      if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw new Error('The bot lacks the Manage Roles permission.');
      }
      if (role.managed || botMember.roles.highest.comparePositionTo(role) <= 0) {
        throw new Error(`Move the bot's highest role above ${role.name}.`);
      }
      if (!targetMember.manageable) {
        throw new Error('The bot cannot manage this member\'s roles. Move the bot role above the member\'s highest role.');
      }
      const isUnban = interaction.commandName === 'ticket-unban';
      const hasTicketBan = targetMember.roles.cache.has(role.id);
      if (isUnban && !hasTicketBan) {
        await interaction.editReply(`<@${targetId}> does not have a ticket restriction to remove.`);
        return;
      }
      if (!isUnban && hasTicketBan) {
        await interaction.editReply(`<@${targetId}> already has the ticket restriction role.`);
        return;
      }

      if (!targetMember.manageable) {
        throw new Error('The bot cannot manage this member\'s roles. Move the bot role above the member\'s highest role.');
      }

      if (isUnban) {
        await targetMember.roles.remove(role, `Ticket ban removed by ${interaction.user.tag}`);
      } else {
        await targetMember.roles.add(role, `Ticket ban added by ${interaction.user.tag}`);
      }

      const warnLogChannelId = (process.env.WARN_LOG_CHANNEL_ID || process.env.WARN_CHANNEL_ID || '').trim();
      if (warnLogChannelId) {
        const warnLogChannel = await client.channels.fetch(warnLogChannelId).catch(() => null);
        if (warnLogChannel?.isTextBased()) {
          await warnLogChannel.send({
            content: `Ticket restriction ${isUnban ? 'removed' : 'applied'}: <@${targetId}> | Moderator: <@${interaction.user.id}>`,
            embeds: [new EmbedBuilder()
              .setColor(isUnban ? 0x57f287 : 0xe05252)
              .setTitle(isUnban ? 'Ticket Restriction Removed' : 'Ticket Restriction Applied')
              .addFields(
                { name: 'User', value: `<@${targetId}>` },
                { name: 'Moderator', value: `<@${interaction.user.id}>` },
              )
              .setTimestamp()],
            allowedMentions: { users: [targetId, interaction.user.id] },
          }).catch((error) => console.error('Ticket ban warn-log send error:', error));
        }
      }
      await interaction.editReply(isUnban
        ? `Removed the ticket restriction from <@${targetId}>.`
        : `Applied ${role} to <@${targetId}>.`);
    } catch (error) {
      console.error('Ticket ban role assignment error:', error);
      await interaction.editReply(`${interaction.commandName === 'ticket-unban' ? 'Could not remove the ticket restriction' : 'Could not apply the ticket restriction'}: ${error.message}`);
    }
    return;
  }

  if (
    interaction.isChatInputCommand()
    && ['ticket-panel', 'receipt-toggle', 'staff-application-toggle', 'media-application-toggle'].includes(interaction.commandName)
    && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({ content: 'You need the Manage Server permission to use this command.', ephemeral: true });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-panel') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const missingPermissions = interaction.channel
        .permissionsFor(interaction.guild.members.me)
        ?.missing([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
        ]) ?? [];

      if (missingPermissions.length > 0) {
        await interaction.editReply(
          `Failed to send the ticket panel. Missing permissions in this channel: ${missingPermissions.join(', ')}.`,
        );
        return;
      }

      await sendPanel(interaction.channel);
      await interaction.editReply('Ticket panel sent.');
    } catch (error) {
      console.error('Ticket panel error:', error);
      await interaction.editReply(`Failed to send the ticket panel. Reason: ${error.message}`);
    }
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'receipt-toggle') {
    await interaction.deferReply({ ephemeral: true });
    const enabled = !dekontSettings.enabled;
    dekontSettings.enabled = enabled;
    saveDekontSettings();

    const panelChannel = await interaction.guild.channels.fetch(process.env.PANEL_CHANNEL_ID).catch(() => null);
    if (!panelChannel?.isTextBased()) {
      await interaction.editReply('The ticket panel channel could not be found. The setting was saved, but the panel could not be updated.');
      return;
    }

    await sendPanel(panelChannel);
    await interaction.editReply(enabled
      ? 'The receipt option was added to the ticket panel.'
      : 'The receipt option was removed from the ticket panel.');
    return;
  }

  if (interaction.isChatInputCommand() && [
    'staff-application-toggle',
    'media-application-toggle',
  ].includes(interaction.commandName)) {
    await interaction.deferReply({ ephemeral: true });
    const isStaffApplication = interaction.commandName === 'staff-application-toggle';
    const settingKey = isStaffApplication ? 'staffEnabled' : 'mediaEnabled';
    const enabled = !applicationSettings[settingKey];
    applicationSettings[settingKey] = enabled;
    saveApplicationSettings();

    const panelChannel = await interaction.guild.channels.fetch(process.env.PANEL_CHANNEL_ID).catch(() => null);
    if (!panelChannel?.isTextBased()) {
      await interaction.editReply('The ticket panel channel could not be found. The setting was saved, but the panel could not be updated.');
      return;
    }

    await sendPanel(panelChannel);
    if (isStaffApplication) {
      await interaction.editReply(enabled
        ? 'Staff applications were enabled in the ticket panel.'
        : 'Staff applications were disabled in the ticket panel.');
    } else {
      await interaction.editReply(enabled
        ? 'Media applications were enabled in the ticket panel and /open menu.'
        : 'Media applications were disabled in the ticket panel and /open menu.');
    }
    return;
  }

  if (interaction.isStringSelectMenu() && (interaction.customId === 'ticket_type' || interaction.customId.startsWith('ticket_type:'))) {
    const locale = 'en';
    if (interaction.values[0] === 'clear_selection') {
      await interaction.update({ components: panelComponents(locale) });
      await interaction.followUp({
        content: localized(locale).selectionCleared,
        ephemeral: true,
      });
      return;
    }

    const selectedType = interaction.values[0];
    const typeKey = resolveTicketType(selectedType, locale);
    if (!ticketTypes[typeKey]) {
      console.warn('Unknown ticket type selected:', {
        customId: interaction.customId,
        value: selectedType,
      });
      await interaction.reply({ content: localized(locale).invalidType, ephemeral: true });
      return;
    }

    if (!isTicketTypeEnabled(typeKey)) {
      await interaction.reply({ content: 'This application type is currently unavailable.', ephemeral: true });
      return;
    }

    if (typeKey === 'Receipt' || typeKey === 'Dekont') {
      if (!receiptSettings.enabled) {
        await interaction.reply({ content: 'The receipt option is currently unavailable.', ephemeral: true });
        return;
      }
      await interaction.showModal(receiptTicketModal(locale));
      return;
    }

    if (typeKey === 'Purchase' || typeKey === 'Satın al') {
      const text = localized(locale);
      const flowId = createPurchaseFlow(locale, interaction);
      const flow = purchaseFlows.get(flowId);
      await interaction.reply({
        content: purchasePrompt(locale, flow),
        components: purchaseProductComponents(locale, flowId),
        ephemeral: true,
      });
      return;
    }

    if (usesSupportForm(typeKey)) {
      await interaction.showModal(supportTicketModal(locale, typeKey));
      return;
    }

    await createTicket(interaction, typeKey, null, locale);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('chat_ticket:')) {
    const [, kind, ownerId] = interaction.customId.split(':');

    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'This selection does not belong to you.', ephemeral: true });
      return;
    }

    if (kind === 'media' && !applicationSettings.mediaEnabled) {
      await interaction.reply({ content: 'Media applications are currently unavailable.', ephemeral: true });
      return;
    }

    if (kind === 'buy') {
      const flowId = createPurchaseFlow('en', interaction);
      const flow = purchaseFlows.get(flowId);
      await interaction.reply({
        content: purchasePrompt('en', flow),
        components: purchaseProductComponents('en', flowId),
        ephemeral: true,
      });
    } else if (kind === 'support') {
      await interaction.showModal(supportTicketModal());
    } else if (kind === 'media') {
      await interaction.showModal(supportTicketModal('en', 'Media Application'));
    }

    await interaction.message.delete().catch(() => null);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_buy_products_continue:')) {
    const [, localeValue, flowId] = interaction.customId.split(':');
    const locale = 'en';
    const flow = purchaseFlows.get(flowId);
    if (!flow || flow.selectedProducts.size === 0) {
      await interaction.reply({
        content: localized(locale).selectionRequired || 'Please select at least one product to continue.',
        ephemeral: true,
      });
      return;
    }

    const nextProductIndex = [...flow.selectedProducts]
      .sort((first, second) => first - second)
      .find((productIndex) => !flow.durations.has(productIndex));
    if (nextProductIndex === undefined) {
      await interaction.update({
        content: localized(locale).paymentPrompt,
        components: purchasePaymentComponents(locale, flowId),
      });
      return;
    }

    await interaction.update({
      content: durationPrompt(locale, nextProductIndex, flow),
      components: purchaseDurationComponents(locale, flowId, nextProductIndex),
    });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_buy_previous:')) {
    const [, localeValue, flowId, target] = interaction.customId.split(':');
    const locale = 'en';
    const flow = purchaseFlows.get(flowId);
    if (!flow) {
      await interaction.reply({ content: localized(locale).invalidType, ephemeral: true });
      return;
    }

    if (target === 'products') {
      await interaction.update({
        content: purchasePrompt(locale, flow),
        components: purchaseProductComponents(locale, flowId),
      });
      return;
    }

    const productIndex = Number(target);
    if (!flow.selectedProducts.has(productIndex) || !flow.durations.has(productIndex)) {
      await interaction.reply({ content: localized(locale).invalidType, ephemeral: true });
      return;
    }

    await interaction.update({
      content: durationPrompt(locale, productIndex, flow),
      components: purchaseDurationComponents(locale, flowId, productIndex),
    });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_buy_payment_continue:')) {
    const [, localeValue, flowId] = interaction.customId.split(':');
    const locale = 'en';
    const flow = purchaseFlows.get(flowId);
    if (!flow || !flow.payment) {
      await interaction.reply({ content: localized(locale).paymentSelectionRequired || 'Please choose a payment method before continuing.', ephemeral: true });
      return;
    }

    await interaction.showModal(purchaseDetailsModal(locale, flowId));
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_buy_product:')) {
    const [, localeValue, flowId] = interaction.customId.split(':');
    const locale = 'en';
    const flow = purchaseFlows.get(flowId);
    if (!flow) {
      await interaction.reply({ content: localized(locale).invalidType, ephemeral: true });
      return;
    }

    const selectedProducts = new Set(interaction.values.map(Number));

    for (let productIndex = 0; productIndex < purchaseProducts.length; productIndex += 1) {
      if (selectedProducts.has(productIndex)) {
        flow.selectedProducts.add(productIndex);
      } else {
        flow.selectedProducts.delete(productIndex);
        flow.durations.delete(productIndex);
      }
    }

    await interaction.update({
      content: purchasePrompt(locale, flow),
      components: purchaseProductComponents(locale, flowId),
    });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_buy_duration:')) {
    const [, localeValue, flowId, productIndexValue] = interaction.customId.split(':');
    const locale = 'en';
    const productIndex = Number(productIndexValue);
    const product = purchaseProducts[productIndex];
    const flow = purchaseFlows.get(flowId);
    const durationIndex = Number(interaction.values[0]);
    if (!product || !flow || !flow.selectedProducts.has(productIndex) || !product.durations[durationIndex]) {
      await interaction.reply({ content: localized(locale).invalidType, ephemeral: true });
      return;
    }

    flow.durations.set(productIndex, durationIndex);
    const nextProductIndex = [...flow.selectedProducts]
      .sort((first, second) => first - second)
      .find((selectedIndex) => !flow.durations.has(selectedIndex));

    if (nextProductIndex === undefined) {
      await interaction.update({
        content: localized(locale).paymentPrompt,
        components: purchasePaymentComponents(locale, flowId),
      });
      return;
    }

    await interaction.update({
      content: durationPrompt(locale, nextProductIndex, flow),
      components: purchaseDurationComponents(locale, flowId, nextProductIndex),
    });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_buy_payment:')) {
    const [, localeValue, flowId] = interaction.customId.split(':');
    const locale = 'en';
    const flow = purchaseFlows.get(flowId);
    const paymentMethod = purchasePaymentMethods.find((method) => method.value === interaction.values[0]);
    if (!flow || !paymentMethod) {
      await interaction.reply({ content: localized(locale).invalidType, ephemeral: true });
      return;
    }

    flow.payment = paymentMethod[locale];
    await interaction.update({
      content: localized(locale).paymentPrompt,
      components: purchasePaymentComponents(locale, flowId),
    });
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_buy_details:')) {
    const [, localeValue, flowId] = interaction.customId.split(':');
    const locale = 'en';
    const flow = purchaseFlows.get(flowId);
    if (!flow) {
      await interaction.reply({ content: localized(locale).invalidType, ephemeral: true });
      return;
    }

    flow.details = interaction.fields.getTextInputValue('details').trim();
    purchaseFlows.delete(flowId);
    const created = await createTicket(interaction, 'Purchase', await purchaseAnswers(flow, locale), locale);
    await flow.sourceInteraction?.editReply({
      content: localized(locale)[created ? 'purchaseFlowCompleted' : 'purchaseFlowUnavailable'] || (created ? 'Your purchase ticket has been created!' : 'Unable to complete the purchase flow.'),
      components: [],
    }).catch(() => null);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_dekont_form:')) {
    const locale = 'en';
    const attachment = interaction.fields.getUploadedFiles('dekont_image', true).first();
    if (!attachment || !isImageAttachment(attachment)) {
      await interaction.reply({
        content: 'Please upload an image file only.',
        ephemeral: true,
      });
      return;
    }

    await createTicket(interaction, 'Dekont', {
      fields: [{
        name: 'Receipt image',
        value: 'Attached to this ticket.',
      }],
      screenshots: [attachment],
    }, locale);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_feedback_reason:')) {
    const [, scoreValue, ownerId, staffId, ticketChannelId, localeValue] = interaction.customId.split(':');
    const locale = 'en';
    const text = localized(locale);
    const reason = interaction.fields.getTextInputValue('reason').trim();

    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: text.feedbackReasonRequired });
      return;
    }
    if (reason.length < 3) {
      await interaction.reply({ content: text.feedbackReasonRequired });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      await logStaffFeedback({
        ownerId,
        staffId,
        ticketChannelId,
        score: Number(scoreValue),
        reason,
        locale,
      });
      await hideClosedTicketFromOwner(ticketChannelId, ownerId);
      await interaction.editReply({ content: text.feedbackThanks });
    } catch (error) {
      console.error('Error saving ticket feedback:', error);
      await interaction.editReply({ content: text.feedbackSaveFailed });
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_support_form')) {
    const [, localeValue, encodedTypeKey] = interaction.customId.split(':');
    const locale = 'en';
    const typeKey = encodedTypeKey ? safeDecode(encodedTypeKey) : 'Technical Support';
    const text = localized(locale);
    const fieldDefinitions = false
      ? [
          { id: 'reseller', name: text.resellerLabel },
          { id: 'duration', name: text.resellerDurationPrompt },
          { id: 'details', name: text.detailsField },
        ]
      : ['Staff Application', 'Media Application'].includes(typeKey)
        ? [
            { id: 'age', name: text.staffApplicationAge },
            { id: 'timezone', name: text.staffApplicationTimezone },
            { id: 'experience', name: text.staffApplicationExperience },
            { id: 'availability', name: text.staffApplicationAvailability },
            { id: 'motivation', name: text.staffApplicationMotivation },
          ]
        : [
            { id: 'issue', name: text.issueField },
            { id: 'product', name: text.productField },
            { id: 'details', name: text.detailsField },
          ];

    await createTicket(interaction, usesSupportForm(typeKey) ? typeKey : 'Technical Support', {
      fields: fieldDefinitions.map(({ id, name }) => ({
        name,
        value: interaction.fields.getTextInputValue(id).trim() || text.unspecified,
      })),
      screenshots: ['Staff Application', 'Media Application'].includes(typeKey)
        ? []
        : [...(interaction.fields.getUploadedFiles('screenshot', false)?.values() || [])],
    }, locale);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_feedback:')) {
    const [, scoreValue, ownerId, staffId, ticketChannelId, localeValue] = interaction.customId.split(':');
    const score = Number(scoreValue);
    const locale = 'en';
    const text = localized(locale);

    if (interaction.user.id !== ownerId || !Number.isInteger(score) || score < 1 || score > 5) {
      await interaction.reply({ content: text.feedbackReasonRequired });
      return;
    }

    if (score <= 3) {
      const modal = new ModalBuilder()
        .setCustomId(`ticket_feedback_reason:${score}:${ownerId}:${staffId}:${ticketChannelId}:${locale}`)
        .setTitle(text.feedbackReasonTitle)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('reason')
              .setLabel(text.feedbackReasonLabel)
              .setPlaceholder(text.feedbackReasonPlaceholder)
              .setStyle(TextInputStyle.Paragraph)
              .setMinLength(3)
              .setMaxLength(1000)
              .setRequired(true),
          ),
        );
      await interaction.showModal(modal);
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      await logStaffFeedback({ ownerId, staffId, ticketChannelId, score, locale });
      await hideClosedTicketFromOwner(ticketChannelId, ownerId);
      await interaction.editReply({ content: text.feedbackThanks });
    } catch (error) {
      console.error('Error saving ticket feedback:', error);
      await interaction.editReply({ content: text.feedbackSaveFailed });
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_claim_decision:')) {
    const locale = 'en';
    await interaction.reply({ content: localized(locale).claimInProgress, ephemeral: true });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
    const data = ticketData(interaction.channel);
    const text = localized(data.locale);
    if (interaction.customId === 'ticket_claim' || interaction.customId.startsWith('ticket_claim_transfer:')) {
      if (!isTicketStaff(interaction)) {
        await interaction.reply({ content: text.staffOnly, ephemeral: true });
        return;
      }
      if (data.status !== 'open') {
        await interaction.reply({ content: text.claimClosed, ephemeral: true });
        return;
      }
      if (data.staffId) {
        await interaction.reply({
          content: text.claimAlreadyTaken.replace('{staff}', `<@${data.staffId}>`),
          ephemeral: true,
        });
        return;
      }
      if (claimingTicketIds.has(interaction.channel.id)) {
        await interaction.reply({ content: text.claimInProgress, ephemeral: true });
        return;
      }

      claimingTicketIds.add(interaction.channel.id);
      const staffName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
      try {
        await interaction.deferReply({ ephemeral: true });
        const owner = await interaction.guild.members.fetch(data.ownerId).catch(() => null);
        await interaction.channel.setTopic(ticketTopic(data.ownerId, data.type, data.locale, interaction.user.id));
        await interaction.channel.setName(ticketName(data.type, owner || { username: data.ownerName }, staffName, data.locale));
        await interaction.message.edit({
          components: ticketComponents(false, data.locale, data.type, staffName),
        });
        await interaction.editReply(text.claimSuccess);
      } finally {
        claimingTicketIds.delete(interaction.channel.id);
      }
      return;
    }
    if (interaction.customId === 'ticket_delete' && !canDeleteTicket(interaction)) {
      await interaction.reply({ content: text.deleteRoleOnly, ephemeral: true });
      return;
    }
    if (interaction.customId === 'ticket_close' && !canCloseTicket(interaction)) {
      await interaction.reply({ content: text.closeRoleOnly, ephemeral: true });
      return;
    }
    if (!['ticket_delete', 'ticket_close'].includes(interaction.customId) && !isTicketStaff(interaction)) {
      await interaction.reply({ content: text.staffOnly, ephemeral: true });
      return;
    }

    if (interaction.customId === 'ticket_close') {
      const closedMessage = text.closed
        .replace('{channel}', interaction.channel)
        .replace('{user}', `<@${interaction.user.id}>`);
      await interaction.update({
        content: closedMessage,
        components: ticketComponents(
          true,
          data.locale,
          data.type,
        ),
      });

      try {
        await interaction.channel.permissionOverwrites.edit(data.ownerId, !data.staffId
          ? {
              id: data.ownerId,
              allow: [PermissionFlagsBits.ViewChannel],
              deny: [PermissionFlagsBits.SendMessages],
            }
          : closedPermissionOverwrite(data.ownerId));
        if (closedTicketCategoryId) {
          await interaction.channel.setParent(closedTicketCategoryId);
        }
        const owner = await interaction.guild.members.fetch(data.ownerId).catch(() => null);
        const claimedStaff = data.staffId
          ? await interaction.guild.members.fetch(data.staffId).catch(() => null)
          : null;
        const staffName = data.staffId && data.staffId !== data.ownerId
          ? claimedStaff?.displayName || 'staff'
          : interaction.user.id !== data.ownerId
            ? interaction.member?.displayName || interaction.user.username
            : '';
        await interaction.channel.setName(ticketName(
          data.type,
          owner || { username: data.ownerName },
          staffName,
          data.locale,
          'closed',
        ));
        await interaction.channel.setTopic(ticketTopic(data.ownerId, data.type, data.locale, data.staffId));
        const recentMessages = await interaction.channel.messages.fetch({ limit: 15 }).catch(() => null);
        if (recentMessages) {
          for (const msg of recentMessages.values()) {
            if (msg.author.id === client.user.id && msg.components.some((row) => row.components.some((c) => c.customId === 'receipt_upload'))) {
              await msg.delete().catch(() => null);
            }
          }
        }
      } catch (error) {
        console.error('Error closing ticket:', error);
        await interaction.channel.send('Failed to close the ticket. Please check the bot\'s channel permissions.');
      }
      return;
    }

    if (interaction.customId === 'ticket_delete') {
      await interaction.deferReply();
      try {
        await interaction.editReply(text.deleteProgress);

        const result = await require('./ticket-delete').deleteTicketWithFallback({
          channel: interaction.channel,
          user: interaction.user,
          sendTranscript,
          deleteChannel: async () => {
            await interaction.channel.delete();
          },
          afterDelete: null,
        });

        if (result.transcriptFailed) {
          await interaction.editReply(`${text.transcriptFailed} ${result.error?.message || text.unknownError}`);
        } else {
          if (result.postDeleteError) {
            await interaction.editReply(`Ticket deleted, but post-delete action failed: ${result.postDeleteError.message}`);
          }
        }
      } catch (error) {
        console.error('Error deleting ticket:', error);
        await interaction.editReply('Failed to delete the ticket. Please check the log channel and the bot\'s permissions.');
      }
    }
  }
  } catch (error) {
    const errorCode = error?.code ?? error?.rawError?.code;

    if (errorCode === 10062) {
      console.warn('Expired interaction ignored.');
      return;
    }

    if (errorCode === 40060) {
      console.warn('Duplicate interaction acknowledgement ignored.');
      return;
    }

    console.error('Interaction error:', {
      type: interaction.type,
      customId: interaction.customId,
      commandName: interaction.commandName,
      userId: interaction.user?.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      code: errorCode,
      error,
    });
    const fallbackMessage =
      typeof error?.message === 'string' && error.message.length > 0
        ? `The operation could not be completed right now. (${error.message.slice(0, 120)})`
        : 'The operation could not be completed right now.';

    if (interaction.deferred) {
      await interaction.editReply(fallbackMessage).catch(() => null);
    } else if (!interaction.replied) {
      await interaction.reply({ content: fallbackMessage, ephemeral: true }).catch(() => null);
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !process.env.CHAT_CHANNEL_ID) return;
  if (message.channelId !== process.env.CHAT_CHANNEL_ID) return;
  if (message.content.trim().toLowerCase() !== '/open') return;

  await message.delete().catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(0xc45cff)
    .setDescription(`${message.author}, please select a ticket type:`);

  const prompt = await message.channel.send({
    embeds: [embed],
    components: chatTicketComponents(message.author.id),
  }).catch(() => null);

  if (!prompt) return;

  setTimeout(() => {
    prompt.delete().catch(() => null);
  }, 60_000);
});

async function loginWhenGatewayIsAvailable() {
  let retryDelay = 1000;

  while (true) {
    try {
      await lookup('gateway.discord.gg');
      break;
    } catch (error) {
      console.error(
        `Could not resolve the Discord gateway (${error.code || error.message}); retrying in ${retryDelay / 1000}s.`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 30_000);
    }
  }

  await client.login(process.env.DISCORD_TOKEN);
}

loginWhenGatewayIsAvailable().catch((error) => {
  console.error('Failed to connect to Discord:', error);
  process.exitCode = 1;
});
