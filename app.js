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
let eventsByPubkey = new Map(); // pubkey -> events[]
let isRunning = false;
let pool = new SimplePool();

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
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
            ws.close();
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
    const url = DOM.relayInput.value.trim();
    if (!url || relays.includes(url)) return;

    DOM.addRelayBtn.disabled = true;
    updateStatus(`Verifying ${url}...`);

    const isValid = await verifyRelay(url);
    if (isValid) {
        relays.push(url);
        renderRelays();
        DOM.relayInput.value = '';
        updateStatus('Relay added.');
    } else {
        alert('Could not connect to relay.');
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
    eventsByPubkey.clear();
    DOM.addressList.innerHTML = '';
    DOM.foundCount.textContent = '0';
    DOM.startBtn.textContent = 'Stop Discovery';
    updateStatus('Connecting to relays...');

    const filter = { kinds: [0], limit: 50 };
    const sub = pool.subscribeMany(relays, [filter], {
        onevent(event) {
            if (isRunning) processEvent(event);
        },
        oneose() {
            if (isRunning) {
                updateStatus('Searching for more events...');
            } else {
                console.log('[Info] oneose ignored because isRunning is false');
            }
        }
    });

    window.activeSub = sub;
}

function stopDiscovery(reason = "stopped") {
    console.log(`[Action] stopDiscovery called with reason: ${reason}`);
    isRunning = false;
    if (window.activeSub) {
        window.activeSub.close();
        window.activeSub = null;
    }
    DOM.startBtn.textContent = 'Start Discovery';
    
    if (reason === "goal") {
        updateStatus('Goal reached: 21 unique addresses found.');
    } else {
        updateStatus('Discovery stopped.');
    }
}

function processEvent(event) {
    if (!isRunning || foundAddresses.size >= 21) return;

    try {
        const content = JSON.parse(event.content);
        const pubkey = event.pubkey;

        // Store event in history
        if (!eventsByPubkey.has(pubkey)) {
            eventsByPubkey.set(pubkey, []);
        }
        const history = eventsByPubkey.get(pubkey);
        
        // Avoid duplicate events
        if (history.some(e => e.id === event.id)) return;
        
        history.push(event);
        // Sort history: newest first
        history.sort((a, b) => b.created_at - a.created_at);

        // Process lud16 from the NEWEST event
        const latestContent = JSON.parse(history[0].content);
        const lud16 = latestContent.lud16;

        if (lud16 && !foundAddresses.has(lud16)) {
            foundAddresses.set(lud16, pubkey);
            renderAddress(lud16, pubkey);
            DOM.foundCount.textContent = foundAddresses.size;
            console.log(`[Discovery] Found address ${foundAddresses.size}/21: ${lud16}`);

            if (foundAddresses.size >= 21) {
                stopDiscovery("goal");
            }
        }
    } catch (e) {
        // Skip malformed content
    }
}

function renderAddress(lud16, pubkey) {
    const li = document.createElement('li');
    li.innerHTML = `
        <span><strong>Found:</strong> ${lud16}</span>
        <button class="view-stats-btn" onclick="showStats('${pubkey}')">Stats</button>
    `;
    DOM.addressList.appendChild(li);
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

        return `
            <li class="timeline-item">
                <div class="timestamp">${date}</div>
                <div><strong>Name:</strong> ${content.display_name || content.name || 'N/A'}</div>
                <div><strong>lud16:</strong> ${content.lud16 || 'N/A'}</div>
                ${changeLabel}
            </li>
        `;
    }).join('');

    DOM.statsModal.classList.remove('hidden');
};

init();
