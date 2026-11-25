const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const util = require('util');
const yts = require("yt-search");
const fetch = require("node-fetch");
const FormData = require('form-data');

const { initUserEnvIfMissing } = require('./settingsdb');
const { initEnvsettings, getSetting } = require('./settings');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    downloadContentFromMessage
    // AIRich imeondolewa hapa kwa sababu baileys ya kawaida haina hii
} = require('@whiskeysockets/baileys');

// ═══════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════
const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['🧩', '🍉', '💜', '🌟', '🪴', '💊', '💫', '🍂', '🎋', '😶‍🌫️', '🫀', '🧿', '👀', '🇹🇿', '🚩', '🥰', '🗿', '💙', '🌝', '🖤', '💚'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/G3ChQEjwrdVBTBUQHWSNHF?mode=ems_copy_t',
    ADMIN_LIST_PATH: './admin.json',
    IMAGE_PATH: 'https://files.catbox.moe/2x9ktu.png',
    NEWSLETTER_JID: '120363412168087937@newsletter',
    NEWSLETTER_MESSAGE_ID: '0088',
    OTP_EXPIRY: 300000,
    BOT_NAME: 'JAYDENXMD',
    OWNER_NAME: 'jayden',
    OWNER_NUMBER: '255696923001',
    BOT_VERSION: '1.0.0',
    BOT_FOOTER: '> Powered by jaydenxmd',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbBe2WY7j6g9hbbT6F0N'
};

const GIFTED_TECH_API = 'https://api.giftedtech.co.ke';
const GIFTED_API_KEY = 'gifted';
const audioEndpoints = ['ytmp3', 'ytaudio'];
const videoEndpoints = ['ytmp4', 'ytvideo'];
const tiktokEndpoints = ['tikdown', 'tiktok'];
const igEndpoints = ['instagram', 'igdown'];
const fbEndpoints = ['fbdown2', 'fbdown'];
const twitterEndpoints = ['twitterdown', 'twitter'];

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════
function formatMessage(title, content, footer) {
    return `${title}\n\n${content}\n\n${footer}`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

function runtime(seconds) {
    seconds = Number(seconds);
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor(seconds % (3600 * 24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = Math.floor(seconds % 60);
    return (d > 0 ? d + "d " : "") + (h > 0 ? h + "h " : "") + (m > 0 ? m + "m " : "") + (s > 0 ? s + "s" : "");
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => crypto.randomBytes(size).toString('hex').slice(0, size);
const isValidBuffer = (buf) => Buffer.isBuffer(buf) && buf.length > 1024;

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    return await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
}

async function ossBuffer(url) {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    return Buffer.from(res.data);
}

async function formatAudio(buffer) { return buffer; }
async function formatVideo(buffer) { return buffer; }

async function searchYouTube(query) {
    try {
        const search = await yts(query);
        if (!search.videos || search.videos.length === 0) return null;
        return search.videos.slice(0, 10).map(item => ({
            title: item.title || 'Unknown',
            url: item.url || `https://youtube.com/watch?v=${item.videoId}`,
            thumbnail: item.thumbnail || 'https://files.catbox.moe/a65obv.jpg',
            channel: item.author?.name || 'YouTube',
            duration: item.timestamp || 'N/A',
            views: item.views || 'N/A'
        }));
    } catch (e) {
        console.error('Search error:', e.message);
        return null;
    }
}

async function queryGiftedAPI(query, endpoints, timeout = 25000) {
    for (const endpoint of endpoints) {
        try {
            const apiUrl = `${GIFTED_TECH_API}/api/download/${endpoint}?apikey=${GIFTED_API_KEY}&url=${encodeURIComponent(query)}`;
            const res = await axios.get(apiUrl, { timeout });
            if (res.data?.status === 200 || res.data?.success) {
                const downloadUrl = res.data?.result?.download_url || res.data?.result?.url || res.data?.download_url || res.data?.url;
                if (downloadUrl) return { success: true, data: res.data, endpoint, download_url: downloadUrl };
            }
        } catch (e) { continue; }
    }
    return { success: false, error: "All endpoints failed" };
}

async function downloadMediaMessage(msg, type) {
    const stream = await msg.download();
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
}

async function writeExifImg(buffer, metadata) {
    const { Sticker, StickerTypes } = require('wa-sticker-formatter');
    const sticker = new Sticker(buffer, {
        pack: metadata.packname,
        author: metadata.author,
        type: StickerTypes.FULL,
        quality: 80
    });
    return await sticker.toBuffer();
}

async function getLoftAIResponse(text) {
    try {
        const res = await axios.get(`https://api.giftedtech.co.ke/api/ai/gpt?apikey=gifted&q=${encodeURIComponent(text)}`, { timeout: 20000 });
        return res.data?.result || null;
    } catch (e) {
        return null;
    }
}

function generateResponseButtons(text, response) {
    return [];
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

// ═══════════════════════════════════════════════
// COMMANDS LIST
// ═══════════════════════════════════════════════
const allCommands = [
    { num: 1, cmd: '.alive', desc: 'Bot status' },
    { num: 2, cmd: '.ping', desc: 'Latency & stats' },
    { num: 3, cmd: '.owner', desc: 'Owner info' },
    { num: 4, cmd: '.publicmode', desc: 'Public mode' },
    { num: 5, cmd: '.privatemode', desc: 'Private mode' },
    { num: 6, cmd: '.jid', desc: 'Your JID' },
    { num: 7, cmd: '.loft', desc: 'AI chat' },
    { num: 8, cmd: '.img [desc]', desc: 'Generate image' },
    { num: 9, cmd: '.sticker', desc: 'Create sticker' },
    { num: 10, cmd: '.vv', desc: 'View once' },
    { num: 11, cmd: '.emojimix', desc: 'Mix emojis' },
    { num: 12, cmd: '.quote', desc: 'GTA V quote' },
    { num: 13, cmd: '.calc', desc: 'Calculate' },
    { num: 14, cmd: '.tourl', desc: 'Upload to URL' },
    { num: 15, cmd: '.meme', desc: 'Random meme' },
    { num: 16, cmd: '.ytsearch', desc: 'Search YouTube' },
    { num: 17, cmd: '.news', desc: 'Latest news' },
    { num: 18, cmd: '.play', desc: 'Download audio' },
    { num: 19, cmd: '.video', desc: 'Download video' },
    { num: 20, cmd: '.sendaudio', desc: 'Send audio from URL' },
    { num: 21, cmd: '.sendvideo', desc: 'Send video from URL' },
    { num: 22, cmd: '.tiktok', desc: 'Download TikTok' },
    { num: 23, cmd: '.ig', desc: 'Download Instagram' },
    { num: 24, cmd: '.fb', desc: 'Download Facebook' },
    { num: 25, cmd: '.twitter', desc: 'Download Twitter' },
    { num: 26, cmd: '.lyrics', desc: 'Song lyrics' },
    { num: 27, cmd: '.qouteislamic', desc: 'Islamic quote' },
    { num: 28, cmd: '.qoutechristian', desc: 'Christian quote' },
    { num: 29, cmd: '.tempmail', desc: 'Temp mail' },
    { num: 30, cmd: '.tagall', desc: 'Tag everyone' },
    { num: 31, cmd: '.hidetag', desc: 'Hidden tag' },
    { num: 32, cmd: '.tagadmins', desc: 'Tag admins' },
    { num: 33, cmd: '.promote', desc: 'Promote to admin' },
    { num: 34, cmd: '.demote', desc: 'Demote admin' },
    { num: 35, cmd: '.kick', desc: 'Kick member' },
    { num: 36, cmd: '.add', desc: 'Add member' },
    { num: 37, cmd: '.mute', desc: 'Mute group' },
    { num: 38, cmd: '.unmute', desc: 'Unmute group' },
    { num: 39, cmd: '.groupname', desc: 'Change group name' },
    { num: 40, cmd: '.gcdesc', desc: 'Change description' },
    { num: 41, cmd: '.link', desc: 'Group link' },
    { num: 42, cmd: '.resetlink', desc: 'Reset link' },
    { num: 43, cmd: '.listrequests', desc: 'Join requests' },
    { num: 44, cmd: '.accept', desc: 'Accept request' },
    { num: 45, cmd: '.reject', desc: 'Reject request' },
    { num: 46, cmd: '.acceptall', desc: 'Accept all' },
    { num: 47, cmd: '.rejectall', desc: 'Reject all' },
    { num: 48, cmd: '.met', desc: 'Group metadata' },
    { num: 49, cmd: '.online', desc: 'Online members' },
    { num: 50, cmd: '.newgroup', desc: 'Create group' },
    { num: 51, cmd: '.left', desc: 'Leave group' },
    { num: 52, cmd: '.onwa', desc: 'Check WhatsApp' },
    { num: 53, cmd: '.vcf', desc: 'Export contacts' },
    { num: 54, cmd: '.status', desc: 'System status' },
    { num: 55, cmd: '.loftmeta', desc: 'LOFT META' },
    { num: 56, cmd: '.getcode', desc: 'View code files' },
    { num: 57, cmd: '.waifu', desc: 'Random waifu' },
    { num: 58, cmd: '.pair', desc: 'Pair bot' },
    { num: 59, cmd: '.catbox', desc: 'Upload to catbox' },
];

// ═══════════════════════════════════════════════
// BUTTON V2 CLASS
// ═══════════════════════════════════════════════
class ButtonV2 {
    constructor(socket) {
        this.socket = socket;
        this.buttons = [];
        this.title = '';
        this.subtitle = '';
        this.body = '';
        this.footer = '';
        this.thumbnail = '';
        this.contextInfo = {};
        this.mentions = [];
    }
    setTitle(t) { this.title = t; return this; }
    setSubtitle(t) { this.subtitle = t; return this; }
    setBody(b) { this.body = b; return this; }
    setFooter(f) { this.footer = f; return this; }
    setThumbnail(u) { this.thumbnail = u; return this; }
    setContextInfo(c) { this.contextInfo = c; return this; }
    setMentions(m) { this.mentions = m || []; return this; }
    addButton(text, id) { this.buttons.push({ buttonId: id, buttonText: { displayText: text }, type: 1 }); return this; }
    addUrlButton(text, url) { this.buttons.push({ buttonId: url, buttonText: { displayText: text }, type: 2 }); return this; }
    addRawButton(btn) { this.buttons.push(btn); return this; }

    async send(chatId, options = {}) {
        try {
            const contextInfo = {
                ...this.contextInfo,
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: "120363398106360290@newsletter",
                    newsletterName: "LOFTxmd"
                }
            };
            if (this.mentions && this.mentions.length > 0) contextInfo.mentionedJid = this.mentions;

            const msg = generateWAMessageFromContent(chatId, {
                buttonsMessage: {
                    contentText: this.body,
                    footerText: this.footer || `🛍️ ʟᴏꜰᴛ-ᴏꜱꜱ ɪɴᴄ`,
                    headerType: 6,
                    locationMessage: {
                        degreesLatitude: 0,
                        degreesLongitude: 0,
                        name: this.title || 'ʟᴏꜰᴛ-ᴏꜱꜱ',
                        address: this.subtitle || "",
                        jpegThumbnail: null
                    },
                    viewOnce: true,
                    contextInfo: contextInfo,
                    buttons: this.buttons.length > 0 ? this.buttons : [
                        { buttonId: ".menu", buttonText: { displayText: '📋 MENU' }, type: 1 }
                    ]
                }
            }, { userJid: this.socket.user.id });

            await this.socket.relayMessage(chatId, msg.message, {
                messageId: msg.key.id,
                additionalNodes: [{
                    tag: 'biz', attrs: {},
                    content: [{
                        tag: 'interactive',
                        attrs: { type: 'native_flow', v: '1' },
                        content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
                    }]
                }]
            });
        } catch (err) {
            console.error('ButtonV2 Error:', err);
            await this.socket.sendMessage(chatId, { text: this.body }, options);
        }
    }
}

// ═══════════════════════════════════════════════
// OCTOKIT & STORAGE
// ═══════════════════════════════════════════════
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = process.env.GITHUB_REPO_OWNER;
const repo = process.env.GITHUB_REPO_NAME;

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();
let botMode = 'public';

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

// ═══════════════════════════════════════════════
// SESSION HELPERS
// ═══════════════════════════════════════════════
async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({ owner, repo, path: 'session' });
        const sessionFiles = data.filter(file =>
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });
        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner, repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
            }
        }
    } catch (error) {
        console.error(`Failed clean duplicate:`, error.message);
    }
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const caption = formatMessage('*Connected ✅*', `📞 Number: ${number}\n❤️ Status: Online`, config.BOT_FOOTER);
    for (const admin of admins) {
        try {
            await socket.sendMessage(`${admin}@s.whatsapp.net`, { image: { url: config.IMAGE_PATH }, caption });
        } catch (error) { }
    }
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage('*🔐 OTP VERIFICATION*', `Your OTP: *${otp}*\nExpires in 5 minutes.`, config.BOT_FOOTER);
    try {
        await socket.sendMessage(userJid, { text: message });
    } catch (error) { throw error; }
}

// ═══════════════════════════════════════════════
// STATUS / NEWSLETTER / REVOCATION HANDLERS
// ═══════════════════════════════════════════════
function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== config.NEWSLETTER_JID) return;
        try {
            const emojis = ['🧩', '🍉', '💜', '🌟', '🪴', '🎂', '💫', '🔫', '🎋', '😶‍🌫️', '🫀', '🧿', '👀', '💔', '🚩', '🥰', '😭', '💙', '🌝', '🖤', '💚'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;
            if (!messageId) return;
            await socket.newsletterReactMessage(config.NEWSLETTER_JID, messageId.toString(), randomEmoji);
        } catch (error) { }
    });
}

async function setupStatusHandlers(socket) {
    const autoReact = getSetting('AUTO_REACT') || 'on';
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
        try {
            if (autoReact === 'on') {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }
            if (config.AUTO_VIEW_STATUS === 'true') {
                try { await socket.readMessages([message.key]); } catch (e) { }
            }
            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                try {
                    await socket.sendMessage(message.key.remoteJid, { react: { text: randomEmoji, key: message.key } }, { statusJidList: [message.key.participant] });
                } catch (e) { }
            }
        } catch (error) { }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;
        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const message = formatMessage('╭──◯', `✖ \`D E L E T E\`\n✖ *From:* ${messageKey.remoteJid}\n✖ *Time:* ${getSriLankaTimestamp()}\n╰──◯`, config.BOT_FOOTER);
        try {
            await socket.sendMessage(userJid, { image: { url: config.IMAGE_PATH }, caption: message });
        } catch (error) { }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;
        const autoReact = getSetting('AUTO_REACT') || 'on';
        if (autoReact === 'on') {
            try { await socket.sendPresenceUpdate('recording', msg.key.remoteJid); } catch (e) { }
        }
    });
}

// ═══════════════════════════════════════════════
// MAIN COMMAND HANDLER
// ═══════════════════════════════════════════════
function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        let command = null;
        let args = [];
        let sender = msg.key.remoteJid;

        const body = (msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption || '').trim();

        if (body.startsWith(config.PREFIX)) {
            const parts = body.slice(config.PREFIX.length).trim().split(/\s+/);
            command = parts[0].toLowerCase();
            args = parts.slice(1);
        } else if (msg.message.buttonsResponseMessage?.selectedButtonId) {
            const btnId = msg.message.buttonsResponseMessage.selectedButtonId;
            if (btnId.startsWith(config.PREFIX)) {
                const parts = btnId.slice(config.PREFIX.length).trim().split(/\s+/);
                command = parts[0].toLowerCase();
                args = parts.slice(1);
            }
        }

        if (!command) return;

        const text = args.join(' ');
        const prefix = config.PREFIX;

        const ownerNumbers = [config.OWNER_NUMBER + '@s.whatsapp