const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const receiptTranslations = {
  en: {
    invalidType: 'Invalid ticket type selected.',
    receiptModalTitle: 'Upload Receipt Image',
    receiptImageLabel: 'Receipt image',
    receiptOrderLabel: 'Order number / Crypto wallet address',
    receiptImageOnly: 'Please upload one image file only.',
    receiptSubmitted: 'Your receipt was sent for approval.',
    receiptChannelMissing: 'The receipt approval channel is not configured. Please contact staff.',
    receiptStaffTitle: 'New Receipt Approval',
    receiptStaffDescription: 'Review the uploaded receipt image and order details.',
    receiptUserField: 'User',
    receiptTicketField: 'Ticket',
    receiptOrderField: 'Order number / Crypto wallet address',
    receiptProductField: 'Products',
    receiptApprove: 'Approve Receipt',
    receiptApproved: 'Receipt approved.',
    receiptAlreadyApproved: 'This receipt has already been approved.',
    receiptStaffOnly: 'Only staff with Administrator permission can approve this receipt.',
    receiptKeysTitle: 'Enter product keys',
    receiptKeyLabel: 'Product key',
    receiptTooManyProducts: 'This ticket contains more than 5 products. Please coordinate key delivery with staff in the ticket.',
    receiptDmTitle: 'Your order was approved',
    receiptDmFailed: 'The keys could not be sent by DM. Check the user\'s DM settings.',
    receiptButtonLabel: 'Send receipt',
    productField: 'Product',
    unspecified: 'Not provided',
  },
};

function localizedReceipt() {
  return receiptTranslations.en;
}

function receiptUploadButton() {
  const text = localizedReceipt();
  return new ButtonBuilder()
    .setCustomId('receipt_upload')
    .setLabel(text.receiptButtonLabel)
    .setEmoji('🧾')
    .setStyle(ButtonStyle.Success);
}

function receiptUploadModal() {
  const text = localizedReceipt();
  return new ModalBuilder()
    .setCustomId('receipt_upload:en')
    .setTitle(text.receiptModalTitle)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(text.receiptImageLabel)
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId('receipt_image')
            .setMinValues(1)
            .setMaxValues(1)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel(text.receiptOrderLabel)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('receipt_order')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true),
        ),
    );
}

function isImageAttachment(attachment) {
  if (attachment.contentType) return attachment.contentType.startsWith('image/');
  return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(attachment.name || '');
}

function receiptMessageData(message) {
  const embed = message.embeds[0];
  if (!embed) return null;
  const fieldValue = (trName, enName) =>
    embed.fields.find((field) => field.name === trName || field.name === enName)?.value || '';
  const ownerId = fieldValue('Kullanıcı', 'User').match(/<@!?([0-9]+)>/)?.[1];
  const ticketChannelId = fieldValue('Ticket', 'Ticket').match(/<#([0-9]+)>/)?.[1];
  const products = fieldValue('Ürünler', 'Products').split('\n').map((line) => line.trim()).filter(Boolean);
  const orderField = embed.fields.find((field) =>
    field.name.startsWith('Sipariş numarası / Kripto cüzdan adresi') ||
    field.name.startsWith('Order number / Crypto wallet address') ||
    field.name.startsWith('Sipariş numarası') ||
    field.name.startsWith('Order number'),
  );
  const orderNumber = orderField?.value || '';
  if (!ownerId || !ticketChannelId || products.length === 0) return null;

  return {
    ownerId,
    ticketChannelId,
    orderNumber,
    products,
    locale: 'en',
  };
}

async function ticketProductLines(client, channel, locale) {
  const productFieldName = localizedReceipt(locale).productField;
  const messages = await channel.messages.fetch({ limit: 50 });
  const ticketMessage = messages.find((message) =>
    message.author.id === client.user.id && message.embeds.some((embed) =>
      embed.fields.some((field) => field.name === productFieldName),
    ),
  );
  const productField = ticketMessage?.embeds[0]?.fields.find((field) => field.name === productFieldName);
  return (productField?.value || '').split('\n').map((line) => line.trim()).filter(Boolean);
}

async function createReceiptSubmission(interaction, attachment, locale, client, ticketData) {
  const text = localizedReceipt(locale);
  const approvalText = localizedReceipt();
  await interaction.deferReply({ ephemeral: true });
  const receiptChannelId = (process.env.RECEIPT_CHANNEL_ID || '').trim();
  const receiptChannel = receiptChannelId
    ? await interaction.guild.channels.fetch(receiptChannelId).catch(() => null)
    : null;
  if (!receiptChannel?.isTextBased()) {
    await interaction.editReply(text.receiptChannelMissing);
    return;
  }

  const ticket = ticketData(interaction.channel);
  const products = await ticketProductLines(client, interaction.channel, locale);
  const orderNumber = interaction.fields.getTextInputValue('receipt_order').trim();
  try {
    await receiptChannel.send({
    embeds: [new EmbedBuilder()
      .setColor(0xe0a23b)
      .setTitle(approvalText.receiptStaffTitle)
      .setDescription(`${interaction.user} · ${approvalText.receiptStaffDescription}`)
      .addFields(
        { name: approvalText.receiptUserField, value: `<@${ticket.ownerId}>`, inline: true },
        { name: approvalText.receiptTicketField, value: `<#${interaction.channelId}>`, inline: true },
        { name: approvalText.receiptOrderField, value: orderNumber },
        { name: approvalText.receiptProductField, value: products.join('\n').slice(0, 1024) || approvalText.unspecified },
      )
      .setImage(attachment.url)
      .setFooter({ text: 'SYSAnomaly Ticket System' })
      .setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('receipt_approve')
        .setLabel(approvalText.receiptApprove)
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
    )],
    allowedMentions: { users: [ticket.ownerId] },
  });
  } catch (error) {
    console.error('Receipt submission error:', error);
    await interaction.editReply(`The receipt could not be sent: ${error.message}`);
    return;
  }

  await interaction.editReply(text.receiptSubmitted);
}

function modalLabel(label) {
  return label.length <= 45 ? label : `${label.slice(0, 42)}...`;
}

async function migrateLegacyReceiptMessage(message, isClosed, data, ticketComponents) {
  const hasReceiptButton = message.components.some((row) =>
    row.components.some((component) => component.customId === 'receipt_approve'),
  );
  if (!hasReceiptButton) return false;

  const embeds = message.embeds.map((embed) => EmbedBuilder.from(embed));
  if (embeds.length > 0) {
    const [ticketEmbed, ...otherEmbeds] = embeds;
    ticketEmbed.setFields(...(ticketEmbed.data.fields || []).filter((field) =>
      !['Dekont Onayı', 'Receipt approval'].includes(field.name),
    ));
    embeds.splice(0, embeds.length, ticketEmbed, ...otherEmbeds);
  }
  await message.edit({
    embeds,
    components: ticketComponents(isClosed, data.locale, data.type, data.staffId ? true : ''),
  }).catch(() => null);
  return true;
}

async function handleReceiptInteraction(interaction, { client, ticketData, isTicketChannel, moveTicketToPurchase }) {
  if (interaction.isButton() && interaction.customId === 'receipt_upload') {
    const data = ticketData(interaction.channel);
    if (!isTicketChannel(interaction.channel)) {
      await interaction.reply({ content: 'This action can only be performed inside ticket channels.', ephemeral: true });
      return true;
    }
    if (data.status !== 'open') {
      await interaction.reply({ content: 'This ticket is closed. Receipts cannot be uploaded to closed tickets.', ephemeral: true });
      return true;
    }
    if (data.type !== 'Purchase' && data.type !== 'Receipt' && data.type !== 'Satın al' && data.type !== 'Dekont') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_move_purchase:${interaction.channelId}`)
          .setLabel('Yes, Move to Purchase')
          .setEmoji('📦')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('ticket_move_cancel')
          .setLabel('Cancel')
          .setEmoji('✖️')
          .setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({
        content: '⚠️ **This ticket is not a Purchase ticket.**\nWould you like to move this ticket to the **Purchase** category to upload your receipt?',
        components: [row],
        ephemeral: true,
      });
      return true;
    }

    await interaction.showModal(receiptUploadModal(data.locale));
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'ticket_move_cancel') {
    await interaction.update({ content: '❌ Ticket move cancelled.', components: [] });
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_move_purchase:')) {
    const data = ticketData(interaction.channel);
    if (!isTicketChannel(interaction.channel) || data.status !== 'open') {
      await interaction.reply({ content: 'This action can only be performed in an open ticket channel.', ephemeral: true });
      return true;
    }

    if (data.ownerId && interaction.user.id !== data.ownerId && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Only the ticket owner or staff can move this ticket.', ephemeral: true });
      return true;
    }

    await interaction.showModal(receiptUploadModal(data.locale));

    if (typeof moveTicketToPurchase === 'function') {
      await moveTicketToPurchase(interaction.channel, data, interaction.user);
    }
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('receipt_upload:')) {
    const locale = 'en';
    const ticket = ticketData(interaction.channel);
    if (!isTicketChannel(interaction.channel) || (!['Purchase', 'Receipt', 'Satın al', 'Dekont'].includes(ticket.type)) || ticket.status !== 'open') {
      const msg = ticket.status !== 'open'
        ? 'This ticket is closed. Receipts cannot be uploaded to closed tickets.'
        : 'Receipts can only be uploaded in purchase tickets.';
      await interaction.reply({ content: msg, ephemeral: true });
      return true;
    }
    const attachment = interaction.fields.getUploadedFiles('receipt_image', true).first();
    if (!attachment || !isImageAttachment(attachment)) {
      await interaction.reply({ content: localizedReceipt(locale).receiptImageOnly, ephemeral: true });
      return true;
    }
    await createReceiptSubmission(interaction, attachment, locale, client, ticketData);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'receipt_approve') {
    const data = receiptMessageData(interaction.message);
    const text = localizedReceipt();
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: text.receiptStaffOnly, ephemeral: true });
      return true;
    }
    const alreadyApproved = interaction.message.components.some((row) =>
      row.components.some((component) => component.customId === 'receipt_approve' && component.disabled),
    );
    if (!data || alreadyApproved) {
      await interaction.reply({ content: text.receiptAlreadyApproved, ephemeral: true });
      return true;
    }
    if (data.products.length > 5) {
      await interaction.reply({ content: text.receiptTooManyProducts, ephemeral: true });
      return true;
    }
    const modal = new ModalBuilder()
      .setCustomId(`receipt_keys:${interaction.channelId}:${interaction.message.id}`)
      .setTitle(text.receiptKeysTitle)
      .addLabelComponents(...data.products.map((product, index) =>
        new LabelBuilder()
          .setLabel(modalLabel(product))
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(`key_${index}`)
              .setPlaceholder(text.receiptKeyLabel)
              .setStyle(TextInputStyle.Short)
              .setMaxLength(1000)
              .setRequired(true),
          ),
      ));
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('receipt_keys:')) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: localizedReceipt().receiptStaffOnly, ephemeral: true });
      return true;
    }
    const [, receiptChannelId, receiptMessageId] = interaction.customId.split(':');
    const receiptChannel = await client.channels.fetch(receiptChannelId).catch(() => null);
    const receiptMessage = receiptChannel?.isTextBased()
      ? await receiptChannel.messages.fetch(receiptMessageId).catch(() => null)
      : null;
    const data = receiptMessage ? receiptMessageData(receiptMessage) : null;
    const text = localizedReceipt();
    const alreadyApproved = receiptMessage?.components.some((row) =>
      row.components.some((component) => component.customId === 'receipt_approve' && component.disabled),
    );
    if (!data || alreadyApproved) {
      await interaction.reply({ content: text.receiptAlreadyApproved, ephemeral: true });
      return true;
    }

    const keys = data.products.map((_, index) => interaction.fields.getTextInputValue(`key_${index}`).trim());
    try {
      // Grant customer / approved receipt role (1556109329730510879) to user
      const guild = interaction.guild || (process.env.GUILD_ID ? await client.guilds.fetch(process.env.GUILD_ID).catch(() => null) : null);
      if (guild && data.ownerId) {
        const member = await guild.members.fetch(data.ownerId).catch(() => null);
        const roleId = (process.env.APPROVED_RECEIPT_ROLE_ID || process.env.VOUCH_ROLE_ID || '1556109329730510879').trim();
        if (member && roleId) {
          await member.roles.add(roleId, 'Receipt approved').catch((err) =>
            console.error('Failed to grant approved receipt role:', err)
          );
        }
      }

      const owner = await client.users.fetch(data.ownerId);
      const keyLines = data.products.map((product, index) =>
        `**${product}**\n\`\`\`\n${keys[index]}\n\`\`\``,
      );
      let dmSent = true;
      await owner.send({
        content: `${text.receiptDmTitle}\n${text.receiptOrderField}: ${data.orderNumber}\n\n${keyLines.join('\n\n')}`,
      }).catch((e) => {
        dmSent = false;
        console.warn('Could not DM user product keys:', e);
      });
      if (data.ticketChannelId) {
        const ticketChannel = await client.channels.fetch(data.ticketChannelId).catch(() => null);
        if (ticketChannel?.isTextBased()) {
          const approvedEmbed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('✅ Receipt Approved')
            .setDescription(`Payment receipt for <@${data.ownerId}> has been approved by ${interaction.user}.\nRole <@&1556109329730510879> has been granted!`);
          if (!dmSent) {
            approvedEmbed.addFields({
              name: '🔑 Product Keys (DM was closed)',
              value: keyLines.join('\n\n').slice(0, 1024),
            });
          }
          await ticketChannel.send({ embeds: [approvedEmbed] }).catch(() => null);
        }
      }

      await receiptMessage.edit({
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('receipt_approve')
            .setLabel(text.receiptApproved)
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success)
            .setDisabled(true),
        )],
      });
      await interaction.reply({ content: text.receiptApproved, ephemeral: true });
    } catch (error) {
      console.error('Receipt key delivery error:', error);
      await interaction.reply({ content: text.receiptDmFailed, ephemeral: true });
    }
    return true;
  }

  return false;
}

module.exports = { handleReceiptInteraction, isImageAttachment, migrateLegacyReceiptMessage, receiptUploadButton };