const net = require('node:net');
const EventEmitter = require('node:events');

const OPCODES = {
    HANDSHAKE: 0,
    FRAME: 1,
    CLOSE: 2,
    PING: 3,
    PONG: 4
};

const DEFAULT_CLIENT_ID = '1543550000133574677'; // MollyStudio Discord Application ID
const shortText = (value, limit) => Array.from(String(value || '').trim()).slice(0, limit).join('');

class DiscordRPC extends EventEmitter {
    constructor(clientId = DEFAULT_CLIENT_ID) {
        super();
        this.clientId = clientId;
        this.socket = null;
        this.connectionGeneration = 0;
        this.connected = false;
        this.isReady = false;
        this.enabled = true;
        this.user = null;
        this.lastActivity = null;
        this.reconnectTimer = null;
        this.incomingBuffer = Buffer.alloc(0);
        this.startTimestamp = Math.floor(Date.now() / 1000);
    }

    getPipePath(id = 0) {
        if (process.platform === 'win32') {
            return `\\\\.\\pipe\\discord-ipc-${id}`;
        }
        const env = process.env;
        const prefix = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || '/tmp';
        return `${prefix.replace(/\/$/, '')}/discord-ipc-${id}`;
    }

    setClientId(_newId) {
        // Application ID is locked to MollyStudio official Discord Client ID
        this.clientId = DEFAULT_CLIENT_ID;
    }

    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    scheduleReconnect() {
        if (this.reconnectTimer || !this.enabled) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, 12000);
        this.reconnectTimer.unref?.();
    }

    connect() {
        if (!this.enabled || this.connected || this.socket) return;
        this.clearReconnectTimer();

        const generation = ++this.connectionGeneration;
        let pipeIndex = 0;

        const tryConnect = () => {
            if (!this.enabled || this.connected || generation !== this.connectionGeneration) return;
            const path = this.getPipePath(pipeIndex);

            let sock;
            try {
                sock = net.createConnection(path);
                this.socket = sock;
                sock.setTimeout(5000, () => sock.destroy(new Error('Discord connection timeout')));
            } catch (err) {
                pipeIndex++;
                if (pipeIndex < 10) {
                    tryConnect();
                } else {
                    this.scheduleReconnect();
                }
                return;
            }

            let isEstablished = false;
            let hasHandledFail = false;

            sock.once('connect', () => {
                if (!this.enabled || this.socket !== sock || generation !== this.connectionGeneration) { sock.destroy(); return; }
                // Keep the timeout until Discord completes the READY handshake.
                isEstablished = true;
                this.socket = sock;
                this.connected = true;
                this.isReady = false;
                this.incomingBuffer = Buffer.alloc(0);
                this.sendHandshake();
                this.emit('connected');
            });

            sock.on('data', chunk => {
                if (this.socket !== sock || generation !== this.connectionGeneration) return;
                if (this.incomingBuffer.length + chunk.length > 2 * 1024 * 1024) { sock.destroy(); return; }
                this.incomingBuffer = Buffer.concat([this.incomingBuffer, chunk]);
                while (this.incomingBuffer.length >= 8) {
                    const op = this.incomingBuffer.readUInt32LE(0);
                    const len = this.incomingBuffer.readUInt32LE(4);
                    if (len > 1024 * 1024 || op > OPCODES.PONG) { sock.destroy(); return; }
                    if (this.incomingBuffer.length < 8 + len) break;
                    const payload = this.incomingBuffer.subarray(8, 8 + len);
                    this.incomingBuffer = this.incomingBuffer.subarray(8 + len);
                    if (op === OPCODES.PING) {
                        const frame = Buffer.alloc(8 + len);
                        frame.writeUInt32LE(OPCODES.PONG, 0);
                        frame.writeUInt32LE(len, 4);
                        payload.copy(frame, 8);
                        sock.write(frame);
                    } else if (op === OPCODES.CLOSE) { sock.destroy(); return; }
                    else if (op === OPCODES.FRAME) this.processMessage(op, payload.toString('utf8'));
                }
            });

            const onSocketFail = () => {
                if (hasHandledFail || generation !== this.connectionGeneration || this.socket !== sock) return;
                hasHandledFail = true;
                this.socket = null;
                try { sock.destroy(); } catch (_) {}

                if (isEstablished) {
                    this.cleanup();
                    this.scheduleReconnect();
                } else {
                    pipeIndex++;
                    if (pipeIndex < 10) {
                        tryConnect();
                    } else {
                        this.scheduleReconnect();
                    }
                }
            };

            sock.once('error', onSocketFail);
            sock.once('close', onSocketFail);
        };

        tryConnect();
    }

    processMessage(op, jsonStr) {
        try {
            const parsed = JSON.parse(jsonStr);

            if (parsed.evt === 'READY') {
                this.isReady = true;
                this.socket?.setTimeout(0);
                this.user = parsed.data?.user || null;
                this.emit('ready', parsed.data);
                if (this.lastActivity) {
                    this.applyActivity(this.lastActivity);
                }
            } else if (parsed.evt === 'ERROR' || parsed.code) {
                console.warn('[DiscordRPC] Discord error:', parsed);
                if (this.listenerCount('error')) this.emit('error', parsed);
            } else if (parsed.cmd === 'SET_ACTIVITY') {
                this.emit('activity_set', parsed.data);
            }
        } catch (e) {
            console.error('[DiscordRPC] JSON parse error:', e.message);
        }
    }

    cleanup() {
        this.connectionGeneration++;
        this.clearReconnectTimer();
        this.connected = false;
        this.isReady = false;
        this.user = null;
        this.incomingBuffer = Buffer.alloc(0);
        if (this.socket) {
            try { this.socket.destroy(); } catch (_) {}
            this.socket = null;
        }
    }

    reconnect() {
        this.cleanup();
        this.clearReconnectTimer();
        this.connect();
    }

    encode(op, data) {
        const payload = JSON.stringify(data);
        const len = Buffer.byteLength(payload);
        const buf = Buffer.alloc(8 + len);
        buf.writeInt32LE(op, 0);
        buf.writeInt32LE(len, 4);
        buf.write(payload, 8, len, 'utf-8');
        return buf;
    }

    send(op, data) {
        if (!this.socket || !this.connected) return;
        try {
            this.socket.write(this.encode(op, data));
        } catch (e) {
            console.error('[DiscordRPC] Send error:', e.message);
        }
    }

    sendHandshake() {
        this.send(OPCODES.HANDSHAKE, {
            v: 1,
            client_id: this.clientId
        });
    }

    setActivity(activity = {}) {
        if (!activity || typeof activity !== 'object' || Array.isArray(activity)) return;
        if (Buffer.byteLength(JSON.stringify(activity)) > 16 * 1024) throw Error('Слишком большие данные Discord.');
        this.lastActivity = activity;
        if (!this.enabled) return;

        if (!this.connected || !this.socket) {
            this.connect();
            return;
        }

        if (this.isReady) {
            this.applyActivity(activity);
        }
    }

    applyActivity(activity) {
        if (!this.connected || !this.socket || !this.isReady) return;

        let startSec = this.startTimestamp;
        if (Number.isFinite(activity.startTimestamp) && activity.startTimestamp > 0) {
            startSec = activity.startTimestamp > 1e11 
                ? Math.floor(activity.startTimestamp / 1000) 
                : Math.floor(activity.startTimestamp);
        }

        const assets = {};
        if (typeof (activity.largeImageKey || activity.large_image) === 'string') {
            assets.large_image = shortText(activity.largeImageKey || activity.large_image, 256);
        }
        if (typeof (activity.largeImageText || activity.large_text) === 'string') {
            assets.large_text = shortText(activity.largeImageText || activity.large_text, 128);
        }
        if (typeof (activity.smallImageKey || activity.small_image) === 'string') {
            assets.small_image = shortText(activity.smallImageKey || activity.small_image, 256);
        }
        if (typeof (activity.smallImageText || activity.small_text) === 'string') {
            assets.small_text = shortText(activity.smallImageText || activity.small_text, 128);
        }

        const detailsStr = shortText(activity.details || 'MollyStudio', 128);
        const stateStr = shortText(activity.state || 'Редактирование GUI', 128);

        const payload = {
            cmd: 'SET_ACTIVITY',
            args: {
                pid: process.pid,
                activity: activity ? {
                    details: Array.from(detailsStr).length >= 2 ? detailsStr : 'MollyStudio',
                    state: Array.from(stateStr).length >= 2 ? stateStr : 'В редакторе',
                    timestamps: activity.showTime !== false ? {
                        start: startSec
                    } : undefined,
                    assets: Object.keys(assets).length > 0 ? assets : undefined,
                    instance: true
                } : null
            },
            nonce: Date.now().toString(36)
        };

        this.send(OPCODES.FRAME, payload);
    }

    clearActivity() {
        this.lastActivity = null;
        if (this.connected && this.socket && this.isReady) {
            this.send(OPCODES.FRAME, {
                cmd: 'SET_ACTIVITY',
                args: {
                    pid: process.pid,
                    activity: null
                },
                nonce: Date.now().toString(36)
            });
        }
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
        if (!this.enabled) {
            this.clearActivity();
            this.cleanup();
            this.clearReconnectTimer();
        } else {
            this.connect();
        }
    }

    getStatus() {
        return {
            enabled: this.enabled,
            connected: this.connected,
            isReady: this.isReady,
            clientId: this.clientId,
            user: this.user ? {
                username: this.user.username,
                global_name: this.user.global_name
            } : null
        };
    }
}

module.exports = {DiscordRPC};
