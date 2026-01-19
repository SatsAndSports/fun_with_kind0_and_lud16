import { SimplePool } from 'nostr-tools';

// --- State ---
const DEFAULT_RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.snort.social',
    'wss://purplepag.es'
];

let relays = [...DEFAULT_RELAYS];
let foundAddresses = new Map(); // lud16 -> pubkey
let addressRelays = new Map(); // lud16 -> Set<relayUrl>
let addressElements = new Map(); // lud16 -> DOM element
let eventsByPubkey = new Map(); // pubkey -> events[] (event now includes seenOn Set)
let isRunning = false;
let pool = new SimplePool();
let activeSubs = [];

const DOM = {
    relayInput: document.getElementById('relayInput'),
    addRelayBtn: document.getElementById('addRelayBtn'),
    relayList: document.getElementById('relayList'),
    startBtn: document.getElementById('startBtn'),
    status: document.getElementById('status'),
    foundCount: document.getElementById('foundCount'),
    addressList: document.getElementById('addressList'),
    statsModal: document.getElementById('statsModal'),
    userStats: document.getElementById('userStats'),
    historyTimeline: document.getElementById('historyTimeline'),
    closeModal: document.querySelector('.close-btn')
};

// Helper to update status with logging
function updateStatus(msg) {
    console.log(`[Status Update] isRunning=${isRunning}: ${msg}`);
    DOM.status.textContent = msg;
}

// --- Initialization ---
function init() {
    renderRelays();
    setupEventListeners();
}

function setupEventListeners() {
    DOM.addRelayBtn.onclick = handleAddRelay;
    DOM.startBtn.onclick = toggleDiscovery;
    DOM.closeModal.onclick = () => DOM.statsModal.classList.add('hidden');
    window.onclick = (e) => {
        if (e.target === DOM.statsModal) DOM.statsModal.classList.add('hidden');
    };
}

// --- Relay Logic ---
async function verifyRelay(url) {
    return new Promise((resolve) => {
        let ws;
        try {
            ws = new WebSocket(url);
        } catch (e) {
            console.error(`[Error] Invalid WebSocket URL: ${url}`, e);
            resolve(false);
            return;
        }

        const timeout = setTimeout(() => {
            if (ws) ws.close();
            resolve(false);
        }, 3000);

        ws.onopen = () => {
            clearTimeout(timeout);
            ws.close();
            resolve(true);
        };
        ws.onerror = () => {
            clearTimeout(timeout);
            resolve(false);
        };
    });
}

async function handleAddRelay() {
    let url = DOM.relayInput.value.trim();
    
    // Basic sanitization
    if (url.startsWith('wss:://')) url = url.replace('wss:://', 'wss://');
    if (url.startsWith('ws:://')) url = url.replace('ws:://', 'ws://');
    
    if (!url) return;
    
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        alert('URL must start with ws:// or wss://');
        return;
    }

    if (relays.includes(url)) {
        alert('Relay already in list.');
        return;
    }

    DOM.addRelayBtn.disabled = true;
    updateStatus(`Verifying ${url}...`);

    const isValid = await verifyRelay(url);
    if (isValid) {
        relays.push(url);
        renderRelays();
        DOM.relayInput.value = '';
        updateStatus('Relay added.');
    } else {
        alert('Could not connect to relay. Please check the URL and your connection.');
        updateStatus('Failed to add relay.');
    }
    DOM.addRelayBtn.disabled = false;
}

function renderRelays() {
    DOM.relayList.innerHTML = relays.map(url => `
        <li>
            <span>${url}</span>
            <button class="remove-btn" onclick="removeRelay('${url}')">Remove</button>
        </li>
    `).join('');
}

window.removeRelay = (url) => {
    relays = relays.filter(r => r !== url);
    renderRelays();
};

// --- Discovery Logic ---
async function toggleDiscovery() {
    if (isRunning) {
        stopDiscovery();
    } else {
        startDiscovery();
    }
}

async function startDiscovery() {
    isRunning = true;
    foundAddresses.clear();
    addressRelays.clear();
    addressElements.clear();
    eventsByPubkey.clear();
    activeSubs = [];
    DOM.addressList.innerHTML = '';
    DOM.foundCount.textContent = '0';
    DOM.startBtn.textContent = 'Stop Discovery';
    updateStatus('Connecting to relays...');

    const filter = { kinds: [0], limit: 50 };
    
    // Subscribe to each relay individually to track source
    relays.forEach(url => {
        const sub = pool.subscribeMany([url], [filter], {
            onevent(event) {
                if (isRunning) processEvent(event, url);
            },
            oneose() {
                if (isRunning) {
                    console.log(`[Info] EOSE received from ${url}`);
                    // We only update status to "Searching..." if we haven't already
                    if (DOM.status.textContent.includes('Connecting')) {
                        updateStatus('Searching for more events...');
                    }
                }
            }
        });
        activeSubs.push(sub);
    });
}

function stopDiscovery(reason = "stopped") {
    console.log(`[Action] stopDiscovery called with reason: ${reason}`);
    isRunning = false;
    
    activeSubs.forEach(sub => sub.close());
    activeSubs = [];
    
    DOM.startBtn.textContent = 'Start Discovery';
    
    if (reason === "goal") {
        updateStatus('Goal reached: 21 unique addresses found.');
    } else {
        updateStatus('Discovery stopped.');
    }
}

function processEvent(event, relayUrl) {
    // We allow processing even if foundAddresses.size >= 21 ONLY if the address is already known (to update relay count)
    // But we stop starting new ones.
    
    try {
        const pubkey = event.pubkey;

        // Store event in history
        if (!eventsByPubkey.has(pubkey)) {
            eventsByPubkey.set(pubkey, []);
        }
        const history = eventsByPubkey.get(pubkey);
        
        // Find if we already have this specific event
        let existingEvent = history.find(e => e.id === event.id);
        
        if (existingEvent) {
            // Already seen this event, just add the relay to the set
            existingEvent.seenOn.add(relayUrl);
        } else {
            // New event for this pubkey
            const eventWithRelay = {
                ...event,
                seenOn: new Set([relayUrl])
            };
            history.push(eventWithRelay);
            // Sort history: newest first
            history.sort((a, b) => b.created_at - a.created_at);
        }

        // Process lud16 from the NEWEST event
        const latestEvent = history[0];
        const latestContent = JSON.parse(latestEvent.content);
        const lud16 = latestContent.lud16;

        if (lud16) {
            // Track relays for this address
            if (!addressRelays.has(lud16)) {
                addressRelays.set(lud16, new Set());
            }
            const relaysForAddress = addressRelays.get(lud16);
            relaysForAddress.add(relayUrl);

            if (!foundAddresses.has(lud16)) {
                if (foundAddresses.size < 21) {
                    foundAddresses.set(lud16, pubkey);
                    renderAddress(lud16, pubkey);
                    DOM.foundCount.textContent = foundAddresses.size;
                    console.log(`[Discovery] Found address ${foundAddresses.size}/21: ${lud16}`);

                    if (foundAddresses.size >= 21) {
                        stopDiscovery("goal");
                    }
                }
            } else {
                // Update existing UI element with new relay count
                updateAddressUI(lud16);
            }
        }
    } catch (e) {
        // Skip malformed content
    }
}

function renderAddress(lud16, pubkey) {
    const li = document.createElement('li');
    li.id = `addr-${btoa(lud16).replace(/=/g, '')}`;
    const relayCount = addressRelays.get(lud16).size;
    li.innerHTML = `
        <span class="addr-text"><strong>Found on ${relayCount} relay${relayCount > 1 ? 's' : ''}:</strong> ${lud16}</span>
        <button class="view-stats-btn" onclick="showStats('${pubkey}')">Stats</button>
    `;
    DOM.addressList.appendChild(li);
    addressElements.set(lud16, li);
}

function updateAddressUI(lud16) {
    const li = addressElements.get(lud16);
    if (li) {
        const relayCount = addressRelays.get(lud16).size;
        const textSpan = li.querySelector('.addr-text');
        if (textSpan) {
            textSpan.innerHTML = `<strong>Found on ${relayCount} relay${relayCount > 1 ? 's' : ''}:</strong> ${lud16}`;
        }
    }
}

// --- Stats Logic ---
window.showStats = (pubkey) => {
    const history = eventsByPubkey.get(pubkey) || [];
    DOM.userStats.innerHTML = `
        <p><strong>Pubkey:</strong> ${pubkey.substring(0, 8)}...${pubkey.substring(pubkey.length - 8)}</p>
        <p><strong>Total Metadata Events:</strong> ${history.length}</p>
    `;

    DOM.historyTimeline.innerHTML = history.map((event, index) => {
        let content;
        try { content = JSON.parse(event.content); } catch (e) { content = {}; }
        
        const date = new Date(event.created_at * 1000).toLocaleString();
        const nextEvent = history[index + 1];
        let changeLabel = "";

        if (nextEvent) {
            try {
                const oldContent = JSON.parse(nextEvent.content);
                if (oldContent.display_name !== content.display_name || oldContent.name !== content.name) {
                    changeLabel = `<div style="color: var(--secondary)">Name changed from "${oldContent.display_name || oldContent.name || 'None'}"</div>`;
                }
            } catch (e) {}
        }

        const relayList = Array.from(event.seenOn).map(url => url.replace('wss://', '').replace('ws://', '')).join(', ');

        return `
            <li class="timeline-item">
                <div class="timestamp">${date}</div>
                <div><strong>Name:</strong> ${content.display_name || content.name || 'N/A'}</div>
                <div><strong>lud16:</strong> ${content.lud16 || 'N/A'}</div>
                <div style="font-size: 0.75rem; color: #888; margin-top: 4px;">
                    <strong>Seen on:</strong> ${relayList}
                </div>
                ${changeLabel}
            </li>
        `;
    }).join('');

    DOM.statsModal.classList.remove('hidden');
};

init();
