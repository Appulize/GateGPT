# GateGPT – WhatsApp Delivery Bot

GateGPT is an automated delivery assistant that listens for messages on WhatsApp Web and responds to couriers using ChatGPT. It can intelligently open a smart gate and notify you of deliveries, using Pushover for alerts and Whisper for voice transcription.

---

## Features

- Intelligent ChatGPT-based replies with courier-specific logic
- Automatic gate open/close via Home Assistant webhooks
- Voice message transcription using OpenAI Whisper
- Pushover notifications
- Instant and delayed (5-minute timeout) reply logic
- Rate limiting per contact
- Ignores group chats
- Configurable via JSON or environment variables
- `systemd` service-ready with `install.sh`

---

## Requirements


- A Home Assistant Operating System installation

**OR**

- Linux server with `systemd`
- Node.js **v18+** installed and available in your `$PATH`
- WhatsApp account (must scan QR code on first login)
- Pushover account (for notifications)
- OpenAI API key (for GPT-4.0 and Whisper)
- Home Assistant webhook URLs (or equivalent endpoints for gate control)

---

## Installation with Home Assistant Operating System

1. In the Add-on Store, click the three dots in the upper right and select "Repositories"
2. Add this url as a repository https://github.com/Appulize/GateGPT
3. You can now install GateGPT as an addon.
4. Go to the addon page and click the Configuration tab and enter all the required details
5. Go back to the first tab and click "Start".
6. Go to the "Log" tab and scan the QR code with WhatsApp (Link Device).

---

## Installation without Home Assistant

1. **Clone the repository**

```bash
git clone https://github.com/Appulize/GateGPT.git
cd GateGPT/gategpt/GateGPT
```

2. **Copy and configure settings**

```bash
cp config.sample.json config.json
```

Then edit `config.json` to include your own values:

- `OPENAI_API_KEY` – Get this from https://platform.openai.com/
- `PUSHOVER_TOKEN` / `PUSHOVER_USER` – From https://pushover.net/
- `GATE_OPEN_URL` / `GATE_CLOSE_URL` – Your webhook endpoints
- Edit the `CHATGPT_SYSTEM_PROMPT` and pay attention to the very end where the bot can be asked for the location. This is safe where i live - you may want to remove it.

3. **Run the installation script**

```bash
./install.sh
```

You will be prompted to choose:
- Installation directory (default: current folder)
- Node.js path (default: output of `which node`)

It will then:
- Copy files
- Create and install a `gate-gpt.service`
- Enable and start the service
- Open the log viewer

---

## First-Time Login

On first launch, you'll see a QR code in the terminal.

1. Open WhatsApp on your phone
2. Tap **Settings > Linked Devices > Link a Device**
3. Scan the QR code shown in the terminal
4. Wait for a "✅ GateGPT is ready!" message in the log

---

## Usage Notes

- Incoming courier messages will trigger a delayed GPT response after 10 seconds, unless you manually reply.
- If the bot detects keywords like “delivery”, or “package”, it will respond and optionally open your gate.
- After replying or opening the gate, the chat is marked as **unread** to stay “invisible” on the account.
- Group chats are ignored by default.
- Voice messages are transcribed and handled just like text.

---

## Configuration

You can either:

- **Edit `config.json`** for static values
- **Use environment variables** to override (`process.env.VARIABLE_NAME`)

Supported config options:

| Key                    | Description                                      |
|------------------------|--------------------------------------------------|
| `OPENAI_API_KEY`       | Your OpenAI API key                              |
| `PUSHOVER_TOKEN`       | Pushover application token                       |
| `PUSHOVER_USER`        | Your Pushover user key                           |
| `GATE_OPEN_URL`        | URL to trigger gate opening                      |
| `GATE_CLOSE_URL`       | URL to trigger gate closing                      |
| `RESPONSE_DELAY_MS`    | Delay before first auto-reply (default: 300000)  |
| `AUTO_CLOSE_DELAY_MS`  | Delay before auto-closing gate (default: 120000) |
| `MAX_MESSAGES_PER_HOUR`| Message rate limiter                             |
| `IGNORE_FILE`          | File path for ignored chat IDs                   |
| `TRIGGER_KEYWORDS`     | Array of regex strings to detect couriers        |
| `CHATGPT_SYSTEM_PROMPT`| Prompt used to guide GPT responses               |

---

## Controlling the Bot

Use these WhatsApp commands from your account:

- `!ignore` – Ignore a specific contact
- `!unignore` – Remove from ignore list

---

## Uninstallation

To remove the service:

```bash
sudo systemctl disable --now gate-gpt.service
sudo rm /etc/systemd/system/gate-gpt.service
```

Then remove the directory if needed:

```bash
rm -rf ~/GateGPT
```

---

## License

MIT – Free for personal and commercial use. Attribution appreciated.

---

## Author

Maciej Swic – [@maciekish](https://github.com/maciekish)

