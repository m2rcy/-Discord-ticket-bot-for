#  Discord Ticket Bot

##  If you have problem for bots you can directly dm me on discord ( <https://discord.com/users/1474932300071436419> ) 

A feature-rich, modular, and fully automated Discord Ticket Management Bot built with **Discord.js v14**. Designed for gaming communities, digital stores, and support teams.

---

##  Key Features

###  1. Dynamic Purchase Flow
- **Product & Duration Selection:** Reads products and pricing directly from `settings.txt`. Users can select up to 5 products and customize durations for each.
- **Payment Method Selection:** Supports Papara, Bank Transfer, Crypto, and Custom payment options.
- **Order Details Modal:** Allows customers to provide specific notes or account details before ticket creation.

###  2. Automated Receipt Approval & Key Delivery
- **Instant Proof Upload:** Customers can attach payment receipts and transaction hashes.
- **Staff Approval Panel:** Embed with receipt preview sent directly to `#receipt-approvals`.
- **License Delivery:** Admins enter license keys via modal; the bot automatically sends keys to the user's DM and logs them in the ticket.
- **Customer Role Assignment:** Automatically assigns the verified customer role upon approval.
- **One-Click Category Migration:** If a customer uploads a receipt in a general support ticket, staff or the customer can move the ticket to the **Purchase** category with a single button click.

###  3. Multi-Category Support System
- **Technical Support:** User-friendly modal asking for problem details, affected product, and optional screenshot attachments.
- **Staff Applications:** Dedicated questionnaire covering Age, Timezone, Experience, Availability, and Motivation.
- **Media Applications:** Specialized application flow for content creators and streamers.
- **On-the-Fly Category Toggles:** Admins can instantly enable/disable applications or receipts via slash commands without restarting the bot.

###  4. Staff Claim & Ticket Management
- **Ticket Claiming:** Staff can claim open tickets with a single click. The bot updates the channel topic, channel name, and button states in real-time.
- **Granular Permissions:** Separate role permissions for claiming, closing, deleting, and reviewing specific application categories.
- **Spam Prevention:** 5-minute cooldown between ticket creations per user (staff are exempt).

###  5. HTML Transcripts & Archiving
- **Offline HTML Transcripts:** Generates clean, standalone HTML transcript files containing all messages and embeds.
- **Dual Logging:** Automatically sends transcripts to the staff log channel and directly to the ticket owner via DM upon ticket deletion.
- **Inactive Ticket Auto-Close:** Background process monitors channels every 15 minutes and automatically closes tickets inactive for 24+ hours.

###  6. Staff Rating & Feedback System
- **1 to 5 Star Rating:** Ticket owners can rate their support experience when closing a ticket.
- **Low-Rating Feedback Modal:** Users giving 1-3 stars are prompted to explain their reason.
- **Persistent Logging:** Stores ratings in `staff-feedback-logs.json` and posts detailed embeds to the feedback log channel.

###  7. Ticket Moderation
- `/ticket-ban <user-id>`: Bans abusive members from opening tickets and logs the action with moderator details.
- `/ticket-unban <user-id>`: Lifts ticket restrictions.

---

##  Slash Commands Reference

| Command | Permission | Description |
| :--- | :--- | :--- |
| `/open` | Everyone | Opens a private ephemeral menu to select and create a ticket in chat channels. |
| `/ticket-panel` | Manage Server | Sends or refreshes the main interactive ticket panel in the configured channel. |
| `/receipt-toggle` | Manage Server | Enables or disables the **Receipt** option on the panel without restarting. |
| `/staff-application-toggle` | Manage Server | Enables or disables **Staff Applications** on the panel. |
| `/media-application-toggle` | Manage Server | Enables or disables **Media Applications** on the panel and `/open` menu. |
| `/ticket-ban` | Administrator | Restricts a user from opening tickets. |
| `/ticket-unban` | Administrator | Removes ticket creation restriction from a user. |

---

##  Installation & Setup

### 1. Prerequisites
- [Node.js](https://nodejs.org/) v18.0.0 or higher.
- A Discord Bot Application created on the [Discord Developer Portal](https://discord.com/developers/applications).
- Required Privileged Gateway Intents enabled:
  - **Server Members Intent**
  - **Message Content Intent**

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure `.env`
Copy `.env.example` to `.env` and fill in your Discord IDs:
```bash
cp .env.example .env
```

Key environment variables:
```env
# Bot Credentials
DISCORD_TOKEN=your_bot_token_here
GUILD_ID=your_guild_id_here
PANEL_CHANNEL_ID=your_panel_channel_id_here
LOG_CHANNEL_ID=your_transcript_log_channel_id_here

# Ticket Categories
TICKET_BUY_CATEGORY_ID=category_id_for_purchases
TICKET_SUPPORT_CATEGORY_ID=category_id_for_support
TICKET_STAFFAPPLICATION_CATEGORY_ID=category_id_for_staff_apps
CLOSED_TICKET_CHANNEL_ID=category_id_for_closed_tickets

# Roles
ROLE_SUPPORT=support_staff_role_id
ROLE_BUY=sales_staff_role_id
TICKET_CLOSE_ROLE_ID=close_ticket_role_id
TICKET_DELETE_ROLE_ID=delete_ticket_role_id
APPROVED_RECEIPT_ROLE_ID=customer_role_id
```

### 4. Configure Products (`settings.txt`)
Edit `settings.txt` in the root folder to define products, durations, and pricing:
```txt
Bodycam = 3 Days - $5, 1 Week - $10, 2 Weeks - $15, 1 Month - $30
The Finals = 3 Days - $5, 1 Week - $10, 2 Weeks - $15, 1 Month - $30
```

### 5. Start the Bot
```bash
npm start
```

---

##  Project Structure

```
├── .env                       # Active environment configuration
├── .env.example               # Configuration template
├── package.json               # Dependencies and start script
├── settings.txt               # Products, pricing, and durations definition
├── staff-feedback-logs.json   # Local archive of customer feedback ratings
├── ticket-cooldowns.json      # Active user cooldowns cache
└── src/
    ├── index.js               # Main bot logic, event handlers & commands
    ├── receipts.js            # Payment receipt upload & approval pipeline
    ├── settings.js            # Product parser and English localization
    ├── ticket-delete.js       # Safe deletion & transcript fallback handler
    ├── transcript.js          # HTML transcript generator
    ├── application-settings.json # Dynamic toggles for applications
    └── receipt-settings.json     # Dynamic toggle for receipt tickets
```

---

##  Recommended Bot Permissions
Make sure the bot role has the following Discord permissions:
- **Manage Channels** (Create, delete, update ticket channels and permissions)
- **Manage Roles** (Assign customer and ticket ban roles)
- **View Channels, Send Messages, Embed Links, Attach Files**
- **Manage Messages** (Pin order details and cleanup transient prompts)
- **Read Message History** (Generate complete transcripts)
