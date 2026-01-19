# Nostr lud16 Finder

A powerful web application to discover Lightning Addresses (`lud16`) on the Nostr network, track user profile history, and verify payment addresses.

_All vibe-coded. I described what I knew about Nostr, but the AI designed and implemented everything_

## Features

- **Parallel Relay Streaming**: Connects to multiple relays simultaneously (including archival relays) using `nostr-tools` v2.
- **Real-time Discovery**: Watches Kind 0 (Metadata) events and extracts unique Lightning Addresses.
- **Relay-Source Tracking**: See exactly which relays provided each address (e.g., "Found on 3 relays").
- **Deep Profile History**: 
  - Tracks multiple versions of a user's metadata over time.
  - Automatically queries archival relays (like `nostr.band`) for historical profile versions.
  - View a timeline of name and address changes.
- **Lightning Verification & Payment**:
  - ⚡ button to verify and pay found addresses.
  - Automated LNURL-pay verification (with CORS fallback).
  - Instant QR code generation for scanning with any Lightning wallet.
- **Relay Management**: Built-in relay verification (typo correction and handshake check).
- **Modern UI**: Dark-themed, responsive, and stops automatically after finding 21 unique addresses.

## How to Use

1. **Start Discovery**: Click the "Start Discovery" button to begin streaming from the default relays.
2. **Add Relays**: Use the Relay Management section to add more relays. The app will verify them before adding.
3. **Track History**: Click the **Stats** button on any address to see how many times that user has updated their profile and what changed.
4. **Test & Pay**: Click the **⚡** button to verify if the Lightning Address is active and scan the QR code to send sats.

## Technical Details

- **Vanilla JS & CSS**: No heavy frameworks, just clean ESM modules.
- **Libraries**: 
  - `nostr-tools` v2 for relay communication.
  - `qrcode` for on-the-fly payment codes.
- **Performance**: Individual relay subscriptions to allow per-source metadata tracking.
- **Hosting**: Designed for root-level hosting on GitHub Pages.

## Deployment

Since this uses ES Modules, it must be served over `http` or `https`.
- **Local Dev**: Run `python3 -m http.server` or `npx serve .`.
- **Production**: Push to GitHub and enable GitHub Pages on the root directory.
