import { BehaviorSubject, Observable, ReplaySubject, Subject, filter, finalize, firstValueFrom, from, fromEvent, interval, map, merge, mergeAll, mergeMap, of, tap, timer } from 'rxjs'
import dgram from 'dgram'
import { createHash } from 'crypto'
import { DeviceMetadata } from './DeviceMetadata.js'
import { connect } from 'net'
import { CommandType, MessageParser } from 'tuyapi/lib/message-parser.js'


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

        const ports = [6666, 6667, 6699, 7000]

        return from(ports).pipe(
            mergeMap(port => new Observable<{ msg: Buffer, rinfo: dgram.RemoteInfo }>(o => {
                const listener = dgram.createSocket({ type: 'udp4', reuseAddr: true })
                listener.on('message', (msg, rinfo) => o.next({
                    rinfo,
                    msg
                }))
                listener.bind(port)
                return () => {
                    listener.close()
                }
            })),
            map(({ msg, rinfo }) => { 
                for (const version of [3.3, 3.5]) {
                    try {
                        const parser = new MessageParser({
                            key: UDP_KEY,
                            version
                        })
                        return parser.parse(msg) as Array<{ payload: DiscoverPayload }>
                    } catch (e) { }
                }
                return []
            }),
            mergeAll()
        )
    }

    #devices = new Map<string, BehaviorSubject<RawDps | undefined>>()
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
        this.#seq = 100
        this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}> [CONNECTING] ${this.config.name}`)


        const parser = new MessageParser({
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
            this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}> [ERROR] ${this.config.name} `)
            this.$status.next('offline')
            return
        }
        this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}> [CONNECTED]  ${this.config.name}`)


        const connection = merge(

            // Map response
            fromEvent(socket, 'data').pipe(
                map(data => parser.parse(data) as Array<CmdResponse>),
                mergeAll(),
                // tap(data => {
                //     const cmd = Object.entries(CommandType).find(([, v]) => v == data.commandByte)
                //     this.#DEBUG && console.log({
                //         receive: cmd,
                //         ...data
                //     })
                // }),
                mergeMap(async data => {
                    const just_online = this.$status.getValue() != 'online'
                    this.#seq = Math.max(this.#seq, data.sequenceN)
                    const p = data.payload as { dps: RawDps, cid: string }
                    if (p.dps && Object.keys(p.dps).length > 0) {
                        const id = p.cid || this.config.id
                        const $dps = this.registerDps(id)
                        const is_button_dps = ["single_click", "double_click", "long_press"].some(
                            key => p.dps[key] != undefined
                        )
                        const is_dps_changed = Object.keys(p.dps).some(key => p.dps[key] != $dps.value?.[key])
                        if (just_online || is_button_dps || is_dps_changed) {
                            $dps.next(p.dps)
                        }
                    }
                    const pp = data.payload as SubDeviceReport
                    if (pp.reqType == 'subdev_online_stat_report') {
                        pp.data.online?.forEach(id => this.$subDevReports.next({ id, online: true }))
                        pp.data.offline?.forEach(id => this.$subDevReports.next({ id, online: false }))
                    }
                    this.#$response.next(data)
                    just_online && setTimeout(() => {
                        this.$status.next('online')
                        this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}> [STREAMING]  ${this.config.name} `)
                    }, 1000)
                })
            ),

            // Map request 
            this.#$request.pipe(
                filter(e => !!e.payload.commandByte),
                mergeMap(async ({ payload, sequenceN }) => {
                    const cmd = Object.entries(CommandType).find(([k, v]) => v == payload.commandByte)
                    // this.#DEBUG && console.log({ send: cmd, ...payload, seq: sequenceN })
                    const buffer = parser.encode({
                        ...payload,
                        sequenceN
                    })
                    socket.write(buffer)
                }, 1)
            )
        ).pipe(
            finalize(() => {
                socket.end()
                socket.destroy()
            })
        ).subscribe()



        this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}> [SYNCING]    ${this.config.name} `)
        const decrypted = ['3.4', '3.5'].includes(version) ? await this.#negotiate(version, parser) : true

        if (decrypted) {
            await this.refresh()
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
        } else {
            console.error(`[${new Date().toLocaleString()}] [${ip}] <${this.config.id}> Can not setup 3.4 protocol`)
        }
        connection.unsubscribe()
        this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}>  ${this.config.name}:  OFFLINE`)
        this.$status.next('offline')
        await Bun.sleep(1000)
        this.connect({ ip, version })
    }

    connect(payload: Pick<DiscoverPayload, 'ip' | 'version'>) {
        this.#connect(payload)
    }


    async #negotiate(version: string | number, parser: MessageParser) {
        const temp_local_key = parser.cipher.random()
        const payload = await this.cmd({
            data: temp_local_key,
            encrypted: true,
            commandByte: CommandType.SESS_KEY_NEG_START
        })
        if (!(payload instanceof Buffer)) return false

        const temp_remote_key = payload.subarray(0, 16)

        const calcLocalHmac = parser.cipher.hmac(temp_local_key).toString('hex');
        const expLocalHmac = payload.slice(16, 16 + 32).toString('hex');
        if (expLocalHmac !== calcLocalHmac) {
            console.error(`[${new Date().toLocaleString()}] HMAC mismatch(keys): expected ${expLocalHmac}, was ${calcLocalHmac}. ${payload.toString('hex')}`)
            return false
        }

        // Send response 0x05
        await this.cmd({
            data: parser.cipher.hmac(temp_remote_key),
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
            const s = parser.cipher._encrypt34({ data: sessionKey })
            parser.cipher.setSessionKey(s)
        } else {
            const s = parser.cipher._encrypt35({ data: sessionKey, iv: temp_local_key })
            parser.cipher.setSessionKey(s)
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
        return dps
    }


    registerDps(id: string) {
        const $dps = this.#devices.get(id) || new BehaviorSubject<RawDps | undefined>(undefined)
        !this.#devices.has(id) && this.#devices.set(id, $dps)
        return $dps
    }

    close() {
        this.stop$.next(true)
    }

}
