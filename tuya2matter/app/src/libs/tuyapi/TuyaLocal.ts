import { BehaviorSubject, Observable, ReplaySubject, Subject, exhaustMap, filter, finalize, firstValueFrom, fromEvent, interval, map, merge, mergeAll, mergeMap, of, switchMap, take, takeUntil, tap, timer } from 'rxjs'
import dgram from 'dgram'
import { createHash } from 'crypto'
import { DeviceMetadata } from './DeviceMetadata.js'
import { connect } from 'net'
import { CommandType, MessageParser } from 'tuyapi/lib/message-parser.js'
import { version } from 'os'


export type ApiCredential = {
    key: string,
    secret: string,
    user_id: string,
    region?: string
}

export type DiscoverPayload = {
    ip: string,
    version: string
    gwId: string
}

export type DeviceID = string



export type ConnectionStatusCode = 'created' | 'connecting' | 'online' | 'offline'
export type ConnectionStatus = BehaviorSubject<ConnectionStatusCode>

export type RawDps = Partial<{
    [key: string]: string | number | boolean
}>

export type ReadableDps = Partial<{
    residual_electricity: number
    doorcontact_state: boolean
    battery_percentage: number
    percent_control: number
    percent_state: number
    presence_state: string
    control: string
    switch_led: boolean
    bright_value: number
    temp_value: number
    switch: boolean
    fan_speed: string
    light: boolean
    illuminance_value: number
    cur_current: number
    cur_power: number
    cur_voltage: number
    add_ele: number
    closed_opened: "closed" | "open"
    [key: number]: string | number | boolean
}>



export type DpsUpdate = {
    devId: string
    cid: string
    dps: RawDps,
    t: number
}


const UDP_KEY_STRING = 'yGAdlopoPVldABfn';

export const UDP_KEY = createHash('md5').update(UDP_KEY_STRING, 'utf8').digest();
export type SubDeviceReport = {
    reqType: 'subdev_online_stat_report'
    data: {
        online?: string[],
        offline?: string[]
    }
}
export type CmdResponse = {
    payload: DpsUpdate | string | Buffer | SubDeviceReport,
    leftover: boolean,
    commandByte: number,
    sequenceN: number
}


export class TuyaLocal {


    static watch() {

        const parser = new MessageParser({
            key: UDP_KEY,
            version: '3.3'
        })

        const listener = dgram.createSocket({ type: 'udp4', reuseAddr: true })
        listener.bind(6666)

        const listenerEncrypted = dgram.createSocket({ type: 'udp4', reuseAddr: true })
        listenerEncrypted.bind(6667)

        return merge(
            fromEvent(listener, 'message'),
            fromEvent(listenerEncrypted, 'message')
        ).pipe(
            map(data => data as [Buffer, dgram.RemoteInfo]),
            map(([data, info]) => {
                for (const version of [3.3, 3.5]) {
                    try {
                        const parser = new MessageParser({
                            key: UDP_KEY,
                            version
                        })
                        return parser.parse(data) as Array<{ payload: DiscoverPayload }>
                    } catch (e) { }
                }
                return []
            }),
            mergeAll(),
            finalize(() => {
                listener.close()
                listenerEncrypted.close()
            }),
        )
    }

    #devices = new Map<string, ReplaySubject<RawDps>>()
    #$response = new Subject<CmdResponse>()
    #$request = new Subject<{
        payload: any,
        sequenceN: number
    }>()

    public readonly $status = new BehaviorSubject('created') as ConnectionStatus
    public readonly $subDevReports = new Subject<{
        id: string
        online: boolean
    }>

    #$metadata = new ReplaySubject<Pick<DiscoverPayload, 'ip' | 'version'>>(1)
    public readonly stop$ = new ReplaySubject(1)


    #DEBUG = false
    #parser: MessageParser
    constructor(
        public readonly config: Omit<DeviceMetadata, 'ip' | 'version'>,
        private cids: DeviceMetadata[] | false | null
    ) {
        this.#DEBUG = !!(
            process.env.TUYA2MQTT_DEBUG == 'all'
            || process.env.TUYA2MQTT_DEBUG?.includes(this.config.id)
        )
    }

    #seq = 100
    async #connect({ ip, version }: Pick<DiscoverPayload, 'ip' | 'version'>) {
        if (this.$status.getValue() == 'online' || this.$status.getValue() == 'connecting') return
        this.$status.next('connecting')
        this.#$metadata.next({ ip, version })
        this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}>  ${this.config.name}:  Connecting to ${this.config.name}`)


        this.#parser = new MessageParser({
            key: this.config.local_key,
            version: Number(version)
        })


        const socket = await firstValueFrom(
            of(connect({
                host: ip,
                port: this.config.port || 6668,
                keepAlive: true,
                keepAliveInitialDelay: 5
            })).pipe(
                mergeMap(socket => merge(
                    fromEvent(socket, 'error').pipe(map(() => null)),
                    fromEvent(socket, 'connect').pipe(map(() => socket))
                ))
            )
        )
        if (!socket) {
            this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}>  ${this.config.name}:  Can not connect to ${this.config.name} `)
            return
        }
        this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}>  ${this.config.name}:  Connected to ${this.config.name} `)


        const connection = merge(

            // Map response
            fromEvent(socket, 'data').pipe(
                map(data => this.#parser.parse(data) as Array<CmdResponse>),
                mergeAll(),
                tap(data => {
                    const cmd = Object.entries(CommandType).find(([, v]) => v == data.commandByte)
                    this.#DEBUG && console.log({
                        receive: cmd,
                        ...data
                    })
                }),
                mergeMap(async data => {
                    this.#seq = Math.max(this.#seq, data.sequenceN)
                    const p = data.payload as { dps: RawDps, cid: string }
                    if (p.dps || p.cid) {
                        this.$status.getValue() != 'online' && this.$status.next('online')
                        const id = p.cid || this.config.id
                        const $dps = this.#devices.get(id) || new ReplaySubject<RawDps>(1)
                        if ($dps) {
                            const dps = await firstValueFrom($dps)
                            if (Object.keys(p.dps).some(key => (
                                ["single_click", "double_click", "long_press"].includes(p.dps[key] as string)
                                || p.dps[key] != dps[key]
                            ))) {
                                $dps.next(p.dps || {})
                            }
                        }
                        !this.#devices.has(id) && this.#devices.set(id, $dps)
                    }

                    const pp = data.payload as SubDeviceReport
                    if (pp.reqType == 'subdev_online_stat_report') {
                        pp.data.online?.forEach(id => this.$subDevReports.next({ id, online: true }))
                        pp.data.offline?.forEach(id => this.$subDevReports.next({ id, online: false }))
                    }

                    this.#$response.next(data)
                })
            ),

            // Map request 
            this.#$request.pipe(
                filter(e => !!e.payload.commandByte),
                mergeMap(async ({ payload, sequenceN }) => {
                    const cmd = Object.entries(CommandType).find(([k, v]) => v == payload.commandByte)
                    this.#DEBUG && console.log({ send: cmd, ...payload, seq: sequenceN })
                    const buffer = this.#parser.encode({
                        ...payload,
                        sequenceN
                    })
                    socket.write(buffer)
                }, 1)
            )
        ).pipe(
            finalize(() => socket.end())
        ).subscribe()



        this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}>  ${this.config.name}:  Syncing [protocol ${version}]`)
        const decrypted = ['3.4', '3.5'].includes(version) ? await this.#negotiate(version) : true
        if (!decrypted) {
            console.error(`[${new Date().toLocaleString()}] [${ip}] <${this.config.id}> Can not setup 3.4 protocol`)
            connection.unsubscribe()
            return
        }

        await this.refresh()

        this.$status.next('online')
        this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}>  ${this.config.name}:  ONLINE [protocol ${version}]`)

        await firstValueFrom(merge(
            interval(10000).pipe(
                mergeMap(() => this.ping()),
                filter(r => r == null),
            ),

            // Close
            fromEvent(socket, 'close'),
            fromEvent(socket, 'error'),

            // Stop
            this.stop$
        ))
        connection.unsubscribe()
        this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}>  ${this.config.name}:  OFFLINE`)
        this.$status.next('offline')
    }

    connect(payload: Pick<DiscoverPayload, 'ip' | 'version'>) {
        this.#connect(payload)
    }


    async #negotiate(version: string | number) {
        const temp_local_key = this.#parser.cipher.random()
        const payload = await this.cmd({
            data: temp_local_key,
            encrypted: true,
            commandByte: CommandType.SESS_KEY_NEG_START
        })
        if (!(payload instanceof Buffer)) return false

        const temp_remote_key = payload.subarray(0, 16)

        const calcLocalHmac = this.#parser.cipher.hmac(temp_local_key).toString('hex');
        const expLocalHmac = payload.slice(16, 16 + 32).toString('hex');
        if (expLocalHmac !== calcLocalHmac) {
            console.error(`[${new Date().toLocaleString()}] HMAC mismatch(keys): expected ${expLocalHmac}, was ${calcLocalHmac}. ${payload.toString('hex')}`)
            return false
        }

        // Send response 0x05
        await this.cmd({
            data: this.#parser.cipher.hmac(temp_remote_key),
            encrypted: true,
            commandByte: CommandType.SESS_KEY_NEG_FINISH,
        }, 1000, true)

        // Calculate session key
        // @ts-ignore
        const sessionKey = Buffer.from(temp_local_key);
        for (let i = 0; i < temp_local_key.length; i++) {
            sessionKey[i] = temp_local_key[i] ^ temp_remote_key[i];
        }
        if (version == '3.4') {
            const s = this.#parser.cipher._encrypt34({ data: sessionKey })
            this.#parser.cipher.setSessionKey(s)
        } else {
            const s = this.#parser.cipher._encrypt35({ data: sessionKey, iv: temp_local_key })
            this.#parser.cipher.setSessionKey(s)
        }
        return true
    }

    async cmd(payload: { commandByte: number, data: any, encrypted?: boolean }, timeout: number = 3000, slient: boolean = false) {
        if (slient) {
            this.#$request.next({ payload, sequenceN: this.#seq })
            return 
        }
        const sequenceN = ++this.#seq
        this.#$request.next({ payload, sequenceN })
        return await firstValueFrom(merge(
            timer(timeout).pipe(
                map(() => null)
            ),
            this.#$response.pipe(
                filter(response => {
                    if (response.sequenceN == 0 || sequenceN == 101) {
                        return true
                    }
                    return response.sequenceN == sequenceN
                }),
                map(({ payload }) => payload)
            )
        ))
    }

    async refresh() {
        const { version } = await firstValueFrom(this.#$metadata)
        const t = Math.round(new Date().getTime() / 1000).toString()
        const ids = [4, 5, 6, 18, 19, 20]

        if (version == '3.4' || version == '3.5') return this.cmd({
            commandByte: CommandType.DP_REFRESH,
            data: {
                data: {
                    ctype: 0,
                    gwId: this.config.id,
                    devId: this.config.id,
                    dpId: ids,
                    uid: this.config.id,
                },
                protocol: 5,
                t
            },
            encrypted: true
        })

        return this.cmd({
            commandByte: CommandType.DP_REFRESH,
            data: {
                gwId: this.config.id,
                devId: this.config.id,
                t,
                dpId: ids,
                uid: this.config.id,
            }
        })
    }

    ping() {
        return this.cmd({
            commandByte: CommandType.HEART_BEAT,
            data: Buffer.allocUnsafe(0)
        })
    }

    async setDps(dps: RawDps, sub_device_id?: string) {
        const { version } = await firstValueFrom(this.#$metadata)
        const t = Math.round(new Date().getTime() / 1000).toString()

        if (version == '3.4' || version == '3.5') return await this.cmd({
            commandByte: CommandType.CONTROL_NEW,
            data: {
                data: {
                    ctype: 0,
                    ...sub_device_id ? {
                        dps,
                        cid: sub_device_id
                    } : {
                        gwId: this.config.id,
                        devId: this.config.id,
                        dps,
                        uid: this.config.id,
                    }
                },
                protocol: 5,
                t
            },
            encrypted: true
        })

        return await this.cmd({
            commandByte: CommandType.CONTROL,
            data: {
                t,
                ...sub_device_id ? {
                    dps,
                    cid: sub_device_id
                } : {
                    gwId: this.config.id,
                    devId: this.config.id,
                    dps,
                    uid: this.config.id,
                }
            }
        })
    }

    async sync(sub_device_id?: string) {
        const { version } = await firstValueFrom(this.#$metadata)
        const dps = await this.cmd({
            commandByte: version == '3.3' ? CommandType.DP_QUERY : CommandType.DP_QUERY_NEW,
            data: {
                gwId: this.config.id,
                devId: this.config.id,
                t: Math.round(new Date().getTime() / 1000),
                dps: {},
                uid: this.config.id,
                ...sub_device_id ? { cid: sub_device_id } : {}
            }
        }, 5000) as { dps?: any }
        // if (dps as string == 'json obj data unvalid') {
        //     const id = sub_device_id || this.config.id
        //     this.#devices.get(id)?.forEach(s => s.next({}))
        //     console.error(`CAN NOT SYNC ${this.config.name} - json obj data unvalid`)
        // }
        return dps
    }

    async syncAll() {
        if (!this.cids) {
            await this.sync()
            return
        }
        for (const cid of this.cids) {
            await this.sync(cid.id)
        }
    }

    registerDps(id: string) {
        const $dps = this.#devices.get(id) || new ReplaySubject<RawDps>(1)
        !this.#devices.has(id) && this.#devices.set(id, $dps)
        return $dps
    }

    close() {
        this.stop$.next(true)
    }

    async isChild(node_id: string) {
        const dps = this.sync(node_id)
    }

}
