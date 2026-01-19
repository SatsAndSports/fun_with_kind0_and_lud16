import { SimplePool } from 'nostr-tools';
import QRCode from 'qrcode';

// --- State ---
const DEFAULT_RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.snort.social',
    'wss://purplepag.es',
    'wss://relay.nostr.band', // Archival/Search
    'wss://relay.noswhere.com', // Indexer
    'wss://relay.nostr.bg'
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
    payModal: document.getElementById('payModal'),
    userStats: document.getElementById('userStats'),
    historyTimeline: document.getElementById('historyTimeline'),
    payStatus: document.getElementById('payStatus'),
    payAddr: document.getElementById('payAddr'),
    qrCanvas: document.getElementById('qrCanvas'),
    closeBtns: document.querySelectorAll('.close-btn')
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
    window.onclick = (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.add('hidden');
        }
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

    // Filter with higher limit for initial crawl
    const filter = { kinds: [0], limit: 100 };
    
    relays.forEach(url => {
        const sub = pool.subscribeMany([url], [filter], {
            onevent(event) {
                if (isRunning) processEvent(event, url);
            },
            oneose() {
                if (isRunning) {
                    console.log(`[Info] EOSE received from ${url}`);
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
    try {
        const pubkey = event.pubkey;

        if (!eventsByPubkey.has(pubkey)) {
            eventsByPubkey.set(pubkey, []);
        }
        const history = eventsByPubkey.get(pubkey);
        
        let existingEvent = history.find(e => e.id === event.id);
        
        if (existingEvent) {
            existingEvent.seenOn.add(relayUrl);
        } else {
            const eventWithRelay = {
                ...event,
                seenOn: new Set([relayUrl])
            };
            history.push(eventWithRelay);
            history.sort((a, b) => b.created_at - a.created_at);
        }

        const latestEvent = history[0];
        const latestContent = JSON.parse(latestEvent.content);
        const lud16 = latestContent.lud16;

        if (lud16) {
            if (!addressRelays.has(lud16)) {
                addressRelays.set(lud16, new Set());
            }
            addressRelays.get(lud16).add(relayUrl);

            if (!foundAddresses.has(lud16)) {
                if (foundAddresses.size < 21) {
                    foundAddresses.set(lud16, pubkey);
                    renderAddress(lud16, pubkey);
                    DOM.foundCount.textContent = foundAddresses.size;

                    if (foundAddresses.size >= 21) {
                        stopDiscovery("goal");
                    }
                }
            } else {
                updateAddressUI(lud16);
            }
        }
    } catch (e) {}
}

function renderAddress(lud16, pubkey) {
    const li = document.createElement('li');
    li.id = `addr-${btoa(lud16).replace(/=/g, '')}`;
    const relayCount = addressRelays.get(lud16).size;
    const eventCount = eventsByPubkey.get(pubkey).length;
    
    li.innerHTML = `
        <div class="addr-info">
            <span class="addr-text"><strong>Found:</strong> ${lud16}</span>
            <div class="addr-meta">
                Seen on ${relayCount} relay${relayCount > 1 ? 's' : ''} 
                • ${eventCount} version${eventCount > 1 ? 's' : ''} found
            </div>
        </div>
        <div class="btn-group">
            <button class="pay-btn" onclick="showPayModal('${lud16}')">⚡</button>
            <button class="view-stats-btn" onclick="showStats('${pubkey}')">Stats</button>
        </div>
    `;
    DOM.addressList.appendChild(li);
    addressElements.set(lud16, li);
}

function updateAddressUI(lud16) {
    const li = addressElements.get(lud16);
    if (li) {
        const pubkey = foundAddresses.get(lud16);
        const relayCount = addressRelays.get(lud16).size;
        const eventCount = eventsByPubkey.get(pubkey).length;
        const metaDiv = li.querySelector('.addr-meta');
        if (metaDiv) {
            metaDiv.innerHTML = `
                Seen on ${relayCount} relay${relayCount > 1 ? 's' : ''} 
                • ${eventCount} version${eventCount > 1 ? 's' : ''} found
            `;
        }
    }
}

// --- Stats Logic ---
window.showStats = async (pubkey) => {
    renderStatsModal(pubkey);
    console.log(`[Deep Fetch] Querying all relays for history of ${pubkey}...`);
    const historyFilter = { kinds: [0], authors: [pubkey] };
    const sub = pool.subscribeMany(relays, [historyFilter], {
        onevent(event) {
            processEvent(event, "deep-fetch");
            renderStatsModal(pubkey); 
        }
    });
    setTimeout(() => sub.close(), 5000);
};

function renderStatsModal(pubkey) {
    const history = eventsByPubkey.get(pubkey) || [];
    DOM.userStats.innerHTML = `
        <p><strong>Pubkey:</strong> ${pubkey}</p>
        <p style="color: var(--secondary)"><strong>Total Profile Versions Found:</strong> ${history.length}</p>
        <p style="font-size: 0.8rem; opacity: 0.7;">Deep search active for 5s...</p>
    `;

    DOM.historyTimeline.innerHTML = history.map((event, index) => {
        let content;
        try { content = JSON.parse(event.content); } catch (e) { content = {}; }
        
        const d = new Date(event.created_at * 1000);
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const nextEvent = history[index + 1];
        let changeLabel = "";

        if (nextEvent) {
            try {
                const oldContent = JSON.parse(nextEvent.content);
                const nameChanged = (oldContent.display_name || oldContent.name) !== (content.display_name || content.name);
                const lud16Changed = oldContent.lud16 !== content.lud16;
                
                if (nameChanged) {
                    changeLabel += `<div style="color: var(--secondary); font-size: 0.8rem;">↑ Name updated from "${oldContent.display_name || oldContent.name || 'None'}"</div>`;
                }
                if (lud16Changed) {
                    changeLabel += `<div style="color: #4caf50; font-size: 0.8rem;">↑ lud16 updated from "${oldContent.lud16 || 'None'}"</div>`;
                }
            } catch (e) {}
        }

        const relayList = Array.from(event.seenOn)
            .filter(r => r !== "deep-fetch")
            .map(url => url.replace('wss://', '').replace('ws://', ''))
            .join(', ');

        return `
            <li class="timeline-item">
                <div class="timestamp">${date}</div>
                <div><strong>Name:</strong> ${content.display_name || content.name || 'N/A'}</div>
                <div><strong>lud16:</strong> ${content.lud16 || 'N/A'}</div>
                ${relayList ? `<div style="font-size: 0.7rem; color: #888; margin-top: 4px;"><strong>Sources:</strong> ${relayList}</div>` : ''}
                ${changeLabel}
            </li>
        `;
    }).join('');

    DOM.statsModal.classList.remove('hidden');
}

// --- Payment Logic ---
window.showPayModal = async (lud16) => {
    DOM.payAddr.textContent = lud16;
    DOM.payStatus.textContent = "Verifying Lightning Address...";
    DOM.payStatus.style.color = "white";
    DOM.payModal.classList.remove('hidden');

    // Clear previous QR
    const ctx = DOM.qrCanvas.getContext('2d');
    ctx.clearRect(0, 0, DOM.qrCanvas.width, DOM.qrCanvas.height);

    const isValid = await verifyLightningAddress(lud16);
    
    if (isValid) {
        DOM.payStatus.textContent = "Address Verified ✅";
        DOM.payStatus.style.color = "#4caf50";
    } else {
        DOM.payStatus.textContent = "Verification Failed/Blocked (CORS) ⚠️";
        DOM.payStatus.style.color = "#f44336";
    }

    // Generate QR regardless (LNURL-pay format)
    try {
        const lnurl = lud16ToLnurlPay(lud16);
        await QRCode.toCanvas(DOM.qrCanvas, lnurl, {
            width: 250,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });
    } catch (err) {
        console.error(err);
        DOM.payStatus.textContent = "QR Generation Error";
    }
};

async function verifyLightningAddress(lud16) {
    const [user, domain] = lud16.split('@');
    if (!user || !domain) return false;

    const url = `https://${domain}/.well-known/lnurlp/${user}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data.tag === "payRequest";
    } catch (e) {
        console.warn("[Payment] Fetch verification failed (likely CORS):", e);
        return false;
    }
}

function lud16ToLnurlPay(lud16) {
    // For QR codes, many wallets accept the lightning: address format
    // or the raw lightning address. LNURL-pay standard often uses the URL
    // but the lightning: prefix is widely compatible.
    return `lightning:${lud16}`;
}

init();
