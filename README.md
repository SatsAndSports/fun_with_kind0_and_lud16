# Nostr lud16 Finder

A simple web application to discover Lightning Addresses (`lud16`) on the Nostr network.

## Features
- **Parallel Relay Streaming**: Connects to multiple relays simultaneously using `nostr-tools`.
- **Real-time Discovery**: Watches Kind 0 (Metadata) events and extracts `lud16` addresses.
- **User History**: Tracks changes to user profiles over time, showing name changes and metadata updates.
- **Relay Management**: Add and verify new relays before including them in the search.
- **Progress Tracking**: Stops automatically after finding 21 unique addresses.

## How to use
1. Open `index.html` in a web browser.
2. Add any additional relays you wish to search.
3. Click "Start Discovery".
4. Click "Stats" on any found address to see that user's profile history.

## Technical Details
- Built with Vanilla JS and CSS.
- Uses `nostr-tools` v2 for relay communication.
- Hosted on GitHub Pages.
