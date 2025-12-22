import { Character, DeathData, HitData, PingCompensatedCharacter } from "alclient"
import { Loop, LoopName, Strategy } from "../context.js"
import { dashboard } from "../../dashboard/dashboard.js"

/**
 * Strategy that logs game events to the dashboard
 * Includes deduplication logic to avoid duplicate entries
 */
export class DashboardEventStrategy implements Strategy<PingCompensatedCharacter> {
    public loops = new Map<LoopName, Loop<PingCompensatedCharacter>>()

    private onKill: (data: HitData) => void
    private onDeath: (data: DeathData) => void
    private onParty: (data: any) => void
    private onGameResponse: (data: any) => void
    private onPlayer: (data: any) => void

    // Track state to avoid duplicate logs
    private lastPartyMembers: string = ""
    private lastLevel: number = 0
    private lastLevelUpTime: number = 0  // Cooldown for level-up events
    private lastServer: string = ""
    private lastMap: string = ""
    private entityTypes: Map<string, string> = new Map()  // Track entity types
    private onAction: ((data: any) => void) | undefined

    public onApply(bot: PingCompensatedCharacter) {
        // Initialize state
        this.lastLevel = bot.level ?? 0
        this.lastServer = bot.serverData ? `${bot.serverData.region}${bot.serverData.name}` : ""
        this.lastMap = bot.map ?? ""

        // Track entity types on "action" event which fires BEFORE the hit event
        // This lets us capture the type before alclient's hit handler deletes the entity
        this.onAction = (data: any) => {
            // When we attack something, track the target's type
            if (data.attacker === bot.id && data.target) {
                const entity = bot.entities.get(data.target)
                if (entity?.type) {
                    this.entityTypes.set(data.target, entity.type)
                }
            }
            // Limit map size
            if (this.entityTypes.size > 100) {
                const oldest = this.entityTypes.keys().next().value
                if (oldest) this.entityTypes.delete(oldest)
            }
        }
        bot.socket.on("action", this.onAction)

        // Track when we kill something
        this.onKill = (data: HitData) => {
            if (data.kill && data.hid === bot.id) {
                // Get monster type from our tracking map (captured from action event)
                const monsterType = this.entityTypes.get(data.id) ?? "monster"

                // Clean up tracked entity
                this.entityTypes.delete(data.id)

                dashboard.logEvent({
                    type: "kill",
                    character: bot.id,
                    message: `Killed ${monsterType}`,
                    details: { damage: data.damage, monster: monsterType }
                })
            }
        }
        bot.socket.on("hit", this.onKill)

        // Track when we die
        this.onDeath = (data: DeathData) => {
            if (data.id === bot.id) {
                dashboard.logEvent({
                    type: "death",
                    character: bot.id,
                    message: `Died`,
                    details: {}
                })
            }
        }
        bot.socket.on("death", this.onDeath)

        // Track party changes - only log from party leader to avoid duplicates
        this.onParty = (data: any) => {
            if (!data?.list?.length) return

            // Only log if we are the party leader (first in list)
            if (data.list[0] !== bot.id) return

            // Parse previous members from stored string
            const previousSet = new Set(this.lastPartyMembers ? this.lastPartyMembers.split(",") : [])
            const currentSet = new Set(data.list as string[])

            // Find who joined and who left
            const joined = data.list.filter((m: string) => !previousSet.has(m))
            const left = [...previousSet].filter(m => m && !currentSet.has(m))

            // Update stored members
            const currentMembers = data.list.sort().join(",")
            if (currentMembers === this.lastPartyMembers) return
            this.lastPartyMembers = currentMembers

            // Log specific change
            if (joined.length > 0 && previousSet.size > 0) {
                dashboard.logEvent({
                    type: "party",
                    character: bot.id,
                    message: `${joined.join(", ")} joined party`,
                    details: { joined, members: data.list }
                })
            } else if (left.length > 0) {
                dashboard.logEvent({
                    type: "party",
                    character: bot.id,
                    message: `${left.join(", ")} left party`,
                    details: { left, members: data.list }
                })
            } else if (previousSet.size === 0) {
                // First time seeing this party - skip logging to avoid spam on startup
            }
        }
        bot.socket.on("party_update", this.onParty)

        // Track upgrade/compound results and merchant sales
        this.onGameResponse = (data: any) => {
            // Upgrade/compound results
            if (data.response === "upgrade_success" || data.response === "upgrade_fail") {
                const success = data.response === "upgrade_success"
                dashboard.logEvent({
                    type: "upgrade",
                    character: bot.id,
                    message: `Upgrade ${success ? "✅ Success" : "❌ Failed"}`,
                    details: { success }
                })
            }
            if (data.response === "compound_success" || data.response === "compound_fail") {
                const success = data.response === "compound_success"
                dashboard.logEvent({
                    type: "upgrade",
                    character: bot.id,
                    message: `Compound ${success ? "✅ Success" : "❌ Failed"}`,
                    details: { success }
                })
            }
            // Bot buying something (from NPC or merchant)
            if (data.response === "buy_success" && data.name) {
                dashboard.logEvent({
                    type: "buy",
                    character: bot.id,
                    message: `Bought ${data.name}`,
                    details: { item: data.name }
                })
            }
        }
        bot.socket.on("game_response", this.onGameResponse)

        // Track level ups and server hops via player updates
        this.onPlayer = (data: any) => {
            // Level up detection - with 10 second cooldown to prevent duplicates
            const now = Date.now()
            if (data.level && data.level > this.lastLevel && this.lastLevel > 0) {
                // Check cooldown (10 seconds between level-up events for same level)
                if (now - this.lastLevelUpTime > 10_000) {
                    const oldLevel = this.lastLevel
                    this.lastLevel = data.level
                    this.lastLevelUpTime = now
                    dashboard.logEvent({
                        type: "levelup",
                        character: bot.id,
                        message: `Reached level ${data.level}!`,
                        details: { level: data.level, from: oldLevel }
                    })
                } else {
                    // Still update the level even if we skip logging
                    this.lastLevel = data.level
                }
            } else if (data.level) {
                this.lastLevel = data.level
            }

            // Server hop detection
            const currentServer = bot.serverData ? `${bot.serverData.region}${bot.serverData.name}` : ""
            if (currentServer && currentServer !== this.lastServer && this.lastServer !== "") {
                dashboard.logEvent({
                    type: "server",
                    character: bot.id,
                    message: `Hopped to ${currentServer}`,
                    details: { from: this.lastServer, to: currentServer }
                })
            }
            if (currentServer) this.lastServer = currentServer

            // Map/instance change detection
            if (data.map && data.map !== this.lastMap) {
                // Only log instance entries (when in !== map name)
                if (data.in && data.in !== data.map) {
                    dashboard.logEvent({
                        type: "instance",
                        character: bot.id,
                        message: `Entered ${data.map} instance`,
                        details: { map: data.map, instance: data.in }
                    })
                }
                this.lastMap = data.map
            }
        }
        bot.socket.on("player", this.onPlayer)
    }

    public onRemove(bot: PingCompensatedCharacter) {
        if (this.onAction) bot.socket.removeListener("action", this.onAction)
        if (this.onKill) bot.socket.removeListener("hit", this.onKill)
        if (this.onDeath) bot.socket.removeListener("death", this.onDeath)
        if (this.onParty) bot.socket.removeListener("party_update", this.onParty)
        if (this.onGameResponse) bot.socket.removeListener("game_response", this.onGameResponse)
        if (this.onPlayer) bot.socket.removeListener("player", this.onPlayer)
    }
}
