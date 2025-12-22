import { PingCompensatedCharacter } from "alclient"
import { Strategist } from "../strategy_pattern/context.js"
import { WebSocketServer, WebSocket } from "ws"
import http from "http"
import mongoose from "mongoose"
import { BankInformationStrategy } from "../strategy_pattern/strategies/bank.js"

export interface DashboardEvent {
    timestamp: number
    type: "item_transfer" | "gold_transfer" | "party" | "death" | "levelup" | "loot" | "kill" | "banking" | "error" | "upgrade" | "server" | "instance" | "trade" | "sell" | "buy"
    character: string
    message: string
    details?: Record<string, unknown>
}

export interface CharacterStats {
    id: string
    name: string
    type: string
    level: number
    hp: number
    maxHp: number
    mp: number
    maxMp: number
    xp: number
    gold: number
    map: string
    x: number
    y: number
    target?: string
    ping?: number
    server?: string
    skin?: string
    moving?: boolean
    cx?: {
        head?: string
        face?: string
        hair?: string
        hat?: string
        upper?: string
    }
}

export interface DashboardStats {
    totalGold: number
    bankGold: number
    goldGainedPerHour: number
    goldSpentPerHour: number
    xpPerHour: number
    kills: number
    deaths: number
    items: number
    uptime: number
}

interface GoldSnapshot {
    timestamp: number
    gold: number
}

interface XpSnapshot {
    timestamp: number
    xp: number
}

// MongoDB Schema for Dashboard Events
const DashboardEventSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    type: { type: String, required: true, index: true },
    character: { type: String, required: true },
    message: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed }
}, {
    collection: "dashboard_events",
    expires: 604800 // Auto-delete after 7 days (in seconds)
})

// TTL index to auto-delete old events
DashboardEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 604800 })

const DashboardEventModel = mongoose.models.DashboardEvent ||
    mongoose.model("DashboardEvent", DashboardEventSchema)

// MongoDB Schema for Dashboard Stats (persistent counters)
const DashboardStatsSchema = new mongoose.Schema({
    _id: { type: String, default: "global" },
    kills: { type: Number, default: 0 },
    deaths: { type: Number, default: 0 },
    itemsLooted: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now }
}, { collection: "dashboard_stats" })

const DashboardStatsModel = mongoose.models.DashboardStats ||
    mongoose.model("DashboardStats", DashboardStatsSchema)

// MongoDB Schema for Gold History (timeline)
const GoldHistorySchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    totalGold: { type: Number, required: true },  // All characters' gold combined
    bankGold: { type: Number, default: 0 },       // Bank gold
    delta: { type: Number, default: 0 }           // Change from previous snapshot
}, { collection: "gold_history" })

// Auto-delete after 30 days
GoldHistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 })

const GoldHistoryModel = mongoose.models.GoldHistory ||
    mongoose.model("GoldHistory", GoldHistorySchema)

// MongoDB Schema for XP History (timeline)
const XpHistorySchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    totalXp: { type: Number, required: true },    // All characters' XP combined
    delta: { type: Number, default: 0 }           // Change from previous snapshot
}, { collection: "xp_history" })

// Auto-delete after 30 days
XpHistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 })

const XpHistoryModel = mongoose.models.XpHistory ||
    mongoose.model("XpHistory", XpHistorySchema)

export class Dashboard {
    private contexts: Strategist<PingCompensatedCharacter>[] = []
    private wss: WebSocketServer | null = null
    private maxEvents = 500
    private maxErrors = 200

    // Stats tracking
    private startTime = Date.now()
    private kills = 0
    private deaths = 0
    private itemsLooted = 0
    private goldSnapshots: GoldSnapshot[] = []
    private xpSnapshots: XpSnapshot[] = []

    private updateInterval: NodeJS.Timeout | null = null
    private dbReady = false
    private lastTotalGold: number | null = null  // For delta calculations
    private lastTotalXp: number | null = null    // For delta calculations

    constructor() {
        // Take snapshots every 10 seconds for better activity correlation
        setInterval(() => this.takeSnapshots(), 10_000)
        // Load persistent stats from DB
        this.loadPersistentStats()
    }

    private async loadPersistentStats() {
        try {
            if (mongoose.connection.readyState !== 1) {
                // Wait for connection
                await new Promise<void>((resolve) => {
                    const check = () => {
                        if (mongoose.connection.readyState === 1) {
                            resolve()
                        } else {
                            setTimeout(check, 100)
                        }
                    }
                    check()
                })
            }

            // Count events directly from the events collection for accuracy
            const [kills, deaths, items] = await Promise.all([
                (DashboardEventModel as any).countDocuments({ type: "kill" }),
                (DashboardEventModel as any).countDocuments({ type: "death" }),
                (DashboardEventModel as any).countDocuments({ type: "loot" })
            ])

            this.kills = kills || 0
            this.deaths = deaths || 0
            this.itemsLooted = items || 0
            console.log(`Loaded dashboard stats: ${this.kills} kills, ${this.deaths} deaths, ${this.itemsLooted} items`)

            this.dbReady = true
        } catch (e) {
            console.error("Failed to load dashboard stats:", e)
            this.dbReady = true // Continue anyway
        }
    }

    private async savePersistentStats() {
        if (!this.dbReady) return
        try {
            await (DashboardStatsModel as any).findByIdAndUpdate(
                "global",
                {
                    kills: this.kills,
                    deaths: this.deaths,
                    itemsLooted: this.itemsLooted,
                    lastUpdated: new Date()
                },
                { upsert: true }
            ).exec()
        } catch (e) {
            console.error("Failed to save dashboard stats:", e)
        }
    }

    public setContexts(contexts: Strategist<PingCompensatedCharacter>[]) {
        this.contexts = contexts
    }

    public attachToServer(server: http.Server) {
        this.wss = new WebSocketServer({ server, path: "/ws" })

        this.wss.on("connection", async (ws: WebSocket) => {
            console.log("Dashboard client connected")

            // Send initial data with events from DB
            await this.sendFullUpdate(ws)

            // Handle messages from client (for pagination)
            ws.on("message", async (message: string) => {
                try {
                    const data = JSON.parse(message.toString())
                    if (data.type === "loadMore") {
                        const { logType, offset, limit = 50 } = data
                        let result: any[] = []

                        if (logType === "events") {
                            result = await this.getRecentEvents(limit, offset)
                        } else if (logType === "errors") {
                            result = await this.getRecentErrors(limit, offset)
                        } else if (logType === "goldHistory") {
                            result = await this.getGoldHistory(limit, offset)
                        }

                        ws.send(JSON.stringify({
                            type: "moreData",
                            logType,
                            data: result,
                            offset,
                            hasMore: result.length === limit
                        }))
                    }
                } catch (e) {
                    console.error("Error handling WS message:", e)
                }
            })

            ws.on("close", () => {
                console.log("Dashboard client disconnected")
            })
        })

        // Start periodic updates
        this.updateInterval = setInterval(() => this.broadcastUpdate(), 1000)
    }

    private takeSnapshots() {
        const now = Date.now()
        const totalGold = this.getTotalGold()
        const bankGold = this.getBankGold()
        const combinedGold = totalGold + bankGold
        const totalXp = this.getTotalXp()

        this.goldSnapshots.push({ timestamp: now, gold: totalGold })
        this.xpSnapshots.push({ timestamp: now, xp: totalXp })

        // Keep only last hour of snapshots (for rate calculations)
        const oneHourAgo = now - 3600_000
        this.goldSnapshots = this.goldSnapshots.filter(s => s.timestamp > oneHourAgo)
        this.xpSnapshots = this.xpSnapshots.filter(s => s.timestamp > oneHourAgo)

        // Save gold history to database with delta
        if (this.dbReady) {
            const goldDelta = this.lastTotalGold !== null ? combinedGold - this.lastTotalGold : 0
            this.lastTotalGold = combinedGold

            // Only save if there's an actual change
            if (goldDelta !== 0) {
                (GoldHistoryModel as any).create({
                    timestamp: new Date(now),
                    totalGold: totalGold,
                    bankGold: bankGold,
                    delta: goldDelta
                }).catch((e: Error) => console.error("Failed to save gold history:", e))

                // Fetch recent events that might be associated with this gold change
                const windowStart = new Date(now - 5000)
                const windowEnd = new Date(now + 1000);
                (DashboardEventModel as any).find({
                    timestamp: { $gte: windowStart, $lte: windowEnd },
                    type: { $in: ["sell", "buy", "kill", "loot", "banking", "trade", "upgrade"] }
                }).lean().exec().then((events: any[]) => {
                    this.broadcast({
                        type: "goldEntry",
                        data: {
                            timestamp: now,
                            totalGold,
                            bankGold,
                            delta: goldDelta,
                            events: events.map(e => ({
                                type: e.type,
                                message: e.message,
                                character: e.character
                            }))
                        }
                    })
                }).catch(() => {
                    // Fall back to no events
                    this.broadcast({
                        type: "goldEntry",
                        data: { timestamp: now, totalGold, bankGold, delta: goldDelta, events: [] }
                    })
                })
            }

            // Save XP history with delta
            const xpDelta = this.lastTotalXp !== null ? totalXp - this.lastTotalXp : 0
            this.lastTotalXp = totalXp

            // Only save if there's an actual change
            if (xpDelta !== 0) {
                (XpHistoryModel as any).create({
                    timestamp: new Date(now),
                    totalXp: totalXp,
                    delta: xpDelta
                }).catch((e: Error) => console.error("Failed to save XP history:", e))

                // Fetch recent events that might be associated with this XP change
                const windowStart = new Date(now - 5000)
                const windowEnd = new Date(now + 1000);
                (DashboardEventModel as any).find({
                    timestamp: { $gte: windowStart, $lte: windowEnd },
                    type: { $in: ["kill", "levelup"] }
                }).lean().exec().then((events: any[]) => {
                    this.broadcast({
                        type: "xpEntry",
                        data: {
                            timestamp: now,
                            totalXp,
                            delta: xpDelta,
                            events: events.map(e => ({
                                type: e.type,
                                message: e.message,
                                character: e.character
                            }))
                        }
                    })
                }).catch(() => {
                    this.broadcast({
                        type: "xpEntry",
                        data: { timestamp: now, totalXp, delta: xpDelta, events: [] }
                    })
                })
            }
        }
    }

    private getTotalGold(): number {
        return this.contexts.reduce((sum, ctx) => sum + (ctx.bot?.gold ?? 0), 0)
    }

    private getTotalXp(): number {
        // Calculate cumulative XP for each character (XP for all levels + current progress)
        return this.contexts.reduce((sum, ctx) => {
            const bot = ctx.bot
            if (!bot) return sum

            const level = bot.level ?? 1
            const currentXp = bot.xp ?? 0
            const levels = bot.G?.levels

            if (!levels) return sum + currentXp

            // Sum XP required for all previous levels (1 to current level)
            let cumulativeXp = 0
            for (let i = 1; i <= level; i++) {
                cumulativeXp += levels[i] ?? 0
            }

            // Add current progress toward next level
            return sum + cumulativeXp + currentXp
        }, 0)
    }

    private getBankGold(): number {
        // Try to get from BankInformationStrategy's static data first (populated when visiting bank)
        const firstBot = this.contexts[0]?.bot
        if (firstBot?.owner) {
            const bankData = BankInformationStrategy.bankData.get(firstBot.owner)
            if (bankData?.gold !== undefined) {
                return bankData.gold
            }
        }
        // Fall back to bot.bank.gold (may be stale or 0)
        return firstBot?.bank?.gold ?? 0
    }

    private calculateGoldPerHour(): { gained: number; spent: number } {
        if (this.goldSnapshots.length < 2) return { gained: 0, spent: 0 }

        const oldest = this.goldSnapshots[0]
        const newest = this.goldSnapshots[this.goldSnapshots.length - 1]
        const hourFraction = (newest.timestamp - oldest.timestamp) / 3600_000
        if (hourFraction < 0.01) return { gained: 0, spent: 0 }

        // Calculate gains and losses from snapshot deltas
        let totalGained = 0
        let totalSpent = 0

        for (let i = 1; i < this.goldSnapshots.length; i++) {
            const delta = this.goldSnapshots[i].gold - this.goldSnapshots[i - 1].gold
            if (delta > 0) {
                totalGained += delta
            } else {
                totalSpent += Math.abs(delta)
            }
        }

        return {
            gained: Math.round(totalGained / hourFraction),
            spent: Math.round(totalSpent / hourFraction)
        }
    }

    private calculateXpPerHour(): number {
        if (this.xpSnapshots.length < 2) return 0
        const oldest = this.xpSnapshots[0]
        const newest = this.xpSnapshots[this.xpSnapshots.length - 1]
        const hourFraction = (newest.timestamp - oldest.timestamp) / 3600_000
        // Require at least 5 minutes of data for stable rate calculation
        if (hourFraction < 0.08) return 0
        // Clamp to 0 minimum (XP can appear negative due to level-up resets or disconnects)
        return Math.max(0, Math.round((newest.xp - oldest.xp) / hourFraction))
    }

    public getCharacterStats(): CharacterStats[] {
        return this.contexts.map(ctx => {
            const bot = ctx.bot
            return {
                id: bot?.id ?? "unknown",
                name: bot?.id ?? "unknown",
                type: bot?.ctype ?? "unknown",
                level: bot?.level ?? 0,
                hp: bot?.hp ?? 0,
                maxHp: bot?.max_hp ?? 1,
                mp: bot?.mp ?? 0,
                maxMp: bot?.max_mp ?? 1,
                xp: bot?.xp ?? 0,
                maxXp: bot?.G?.levels?.[(bot?.level ?? 1) + 1] ?? (bot?.G?.levels?.[bot?.level ?? 1] ?? 100),
                gold: bot?.gold ?? 0,
                map: bot?.map ?? "unknown",
                x: Math.round(bot?.x ?? 0),
                y: Math.round(bot?.y ?? 0),
                target: bot?.target ?? undefined,
                ping: bot?.ping ?? undefined,
                server: bot?.serverData ? `${bot.serverData.region}${bot.serverData.name}` : undefined,
                skin: bot?.skin ?? undefined,
                moving: bot?.moving ?? false,
                cx: bot?.cx ?? undefined
            }
        })
    }

    public getDashboardStats(): DashboardStats {
        const goldRates = this.calculateGoldPerHour()
        return {
            totalGold: this.getTotalGold(),
            bankGold: this.getBankGold(),
            goldGainedPerHour: goldRates.gained,
            goldSpentPerHour: goldRates.spent,
            xpPerHour: this.calculateXpPerHour(),
            kills: this.kills,
            deaths: this.deaths,
            items: this.itemsLooted,
            uptime: Date.now() - this.startTime
        }
    }

    // Event logging methods - now saves to DB
    public async logEvent(event: Omit<DashboardEvent, "timestamp">) {
        const fullEvent: DashboardEvent = {
            ...event,
            timestamp: Date.now()
        }

        // Update counters
        if (event.type === "kill") this.kills++
        if (event.type === "death") this.deaths++
        if (event.type === "loot") this.itemsLooted++

        // Broadcast event to connected clients immediately
        this.broadcast({ type: "event", data: fullEvent })

        // Save to database asynchronously
        if (this.dbReady) {
            try {
                await (DashboardEventModel as any).create({
                    timestamp: new Date(fullEvent.timestamp),
                    type: fullEvent.type,
                    character: fullEvent.character,
                    message: fullEvent.message,
                    details: fullEvent.details
                })

                // Periodically save stats (every 10 events)
                if ((this.kills + this.deaths + this.itemsLooted) % 10 === 0) {
                    this.savePersistentStats()
                }
            } catch (e) {
                console.error("Failed to save event to DB:", e)
            }
        }
    }

    public logError(character: string, message: string, details?: Record<string, unknown>) {
        this.logEvent({
            type: "error",
            character,
            message,
            details
        })
    }

    private async getRecentEvents(limit = 50, offset = 0): Promise<DashboardEvent[]> {
        if (!this.dbReady) return []
        try {
            const events = await (DashboardEventModel as any)
                .find({ type: { $ne: "error" } })
                .sort({ timestamp: -1 })
                .skip(offset)
                .limit(limit)
                .lean()
                .exec()

            return events.map((e: any) => ({
                timestamp: new Date(e.timestamp).getTime(),
                type: e.type,
                character: e.character,
                message: e.message,
                details: e.details
            }))
        } catch (e) {
            console.error("Failed to fetch events:", e)
            return []
        }
    }

    private async getRecentErrors(limit = 50, offset = 0): Promise<DashboardEvent[]> {
        if (!this.dbReady) return []
        try {
            const events = await (DashboardEventModel as any)
                .find({ type: "error" })
                .sort({ timestamp: -1 })
                .skip(offset)
                .limit(limit)
                .lean()
                .exec()

            return events.map((e: any) => ({
                timestamp: new Date(e.timestamp).getTime(),
                type: e.type,
                character: e.character,
                message: e.message,
                details: e.details
            }))
        } catch (e) {
            console.error("Failed to fetch errors:", e)
            return []
        }
    }

    private async getGoldHistory(limit = 100, offset = 0): Promise<any[]> {
        if (!this.dbReady) return []
        try {
            const history = await (GoldHistoryModel as any)
                .find({})
                .sort({ timestamp: -1 })
                .skip(offset)
                .limit(limit)
                .lean()
                .exec()

            // For each gold snapshot, find events that happened in the same window
            const enrichedHistory = await Promise.all(history.map(async (h: any) => {
                const timestamp = new Date(h.timestamp).getTime()
                const windowStart = new Date(timestamp - 5000) // 5 sec before
                const windowEnd = new Date(timestamp + 5000)   // 5 sec after

                // Get events in this time window that might affect gold
                const events = await (DashboardEventModel as any)
                    .find({
                        timestamp: { $gte: windowStart, $lte: windowEnd },
                        type: { $in: ["sell", "buy", "kill", "loot", "banking", "trade", "upgrade"] }
                    })
                    .lean()
                    .exec()

                return {
                    timestamp: timestamp,
                    totalGold: h.totalGold,
                    bankGold: h.bankGold,
                    delta: h.delta,
                    events: events.map((e: any) => ({
                        type: e.type,
                        message: e.message,
                        character: e.character
                    }))
                }
            }))

            return enrichedHistory
        } catch (e) {
            console.error("Failed to fetch gold history:", e)
            return []
        }
    }

    private async getXpHistory(limit = 100, offset = 0): Promise<any[]> {
        if (!this.dbReady) return []
        try {
            const history = await (XpHistoryModel as any)
                .find({})
                .sort({ timestamp: -1 })
                .skip(offset)
                .limit(limit)
                .lean()
                .exec()

            // For each XP snapshot, find kill events in the same window
            const enrichedHistory = await Promise.all(history.map(async (h: any) => {
                const timestamp = new Date(h.timestamp).getTime()
                const windowStart = new Date(timestamp - 5000)
                const windowEnd = new Date(timestamp + 5000)

                const events = await (DashboardEventModel as any)
                    .find({
                        timestamp: { $gte: windowStart, $lte: windowEnd },
                        type: { $in: ["kill", "levelup"] }
                    })
                    .lean()
                    .exec()

                return {
                    timestamp: timestamp,
                    totalXp: h.totalXp,
                    delta: h.delta,
                    events: events.map((e: any) => ({
                        type: e.type,
                        message: e.message,
                        character: e.character
                    }))
                }
            }))

            return enrichedHistory
        } catch (e) {
            console.error("Failed to fetch XP history:", e)
            return []
        }
    }

    private async sendFullUpdate(ws: WebSocket) {
        const [events, errors, goldHistory, xpHistory, bosses, respawns] = await Promise.all([
            this.getRecentEvents(50),
            this.getRecentErrors(50),
            this.getGoldHistory(100),
            this.getXpHistory(100),
            this.getBosses(),
            this.getRespawns()
        ])

        const data = {
            type: "full",
            characters: this.getCharacterStats(),
            stats: this.getDashboardStats(),
            events,
            errors,
            goldHistory,
            xpHistory,
            bosses,
            respawns
        }
        ws.send(JSON.stringify(data))
    }

    private broadcastUpdate() {
        const data = {
            type: "update",
            characters: this.getCharacterStats(),
            stats: this.getDashboardStats()
        }
        this.broadcast(data)
    }

    private broadcast(data: unknown) {
        if (!this.wss) return
        const message = JSON.stringify(data)
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message)
            }
        })
    }

    private async getBosses(): Promise<any[]> {
        if (!this.dbReady) return []
        try {
            // Fetch from alclient's entities collection (special monsters)
            const entities = await mongoose.connection.db
                .collection("entities")
                .find({})
                .sort({ lastSeen: -1 })
                .limit(20)
                .toArray()

            return entities.map((e: any) => ({
                type: e.type,
                hp: e.hp,
                maxHp: e.max_hp ?? e.hp,
                level: e.level,
                map: e.map,
                x: Math.round(e.x),
                y: Math.round(e.y),
                server: `${e.serverRegion}${e.serverIdentifier}`,
                lastSeen: e.lastSeen
            }))
        } catch (e) {
            console.error("Failed to fetch bosses:", e)
            return []
        }
    }

    private async getRespawns(): Promise<any[]> {
        if (!this.dbReady) return []
        try {
            const now = Date.now()
            // Fetch from alclient's respawns collection
            const respawns = await mongoose.connection.db
                .collection("respawns")
                .find({})
                .sort({ estimatedRespawn: 1 })
                .limit(20)
                .toArray()

            return respawns.map((r: any) => ({
                type: r.type,
                server: `${r.serverRegion}${r.serverIdentifier}`,
                estimatedRespawn: r.estimatedRespawn,
                timeUntil: Math.max(0, r.estimatedRespawn - now)
            }))
        } catch (e) {
            console.error("Failed to fetch respawns:", e)
            return []
        }
    }

    public async stop() {
        // Save stats before stopping
        await this.savePersistentStats()

        if (this.updateInterval) {
            clearInterval(this.updateInterval)
        }
        if (this.wss) {
            this.wss.close()
        }
    }
}

// Singleton instance
export const dashboard = new Dashboard()

