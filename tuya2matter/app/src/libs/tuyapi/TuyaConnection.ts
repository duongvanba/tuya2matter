import { BehaviorSubject, Observable, Subject, debounceTime, exhaustMap, filter, finalize, firstValueFrom, fromEvent, interval, map, merge, mergeAll, mergeMap, of, switchMap, take, takeUntil, tap, timer } from 'rxjs'
import { CommandType, MessageParser } from './message-parser.js'
import dgram from 'dgram'
import { createHash } from 'crypto'
import { DeviceMetadata } from './DeviceMetadata.js'
import { connect } from 'net'



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

export type Dps = {
    [key: string]: string | number | boolean
}

export type DpsUpdate = {
    devId: string
    cid: string
    dps: Dps,
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

export class TuyaConnection {


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
            fromEvent(listenerEncrypted, 'message'),
        ).pipe(
            map(data => data as [Buffer, dgram.RemoteInfo]),
            finalize(() => {
                listener.close()
                listenerEncrypted.close()
            }),
            map(([data, info]) => {
                try {
                    return parser.parse(data) as Array<{ payload: DiscoverPayload }>
                } catch (e) {
                    return []
                }
            }),
            mergeAll(),
            map(p => p.payload),
        )
    }

    #devices = new Map<string, BehaviorSubject<Dps>>()

    #$response = new Subject<CmdResponse>()

    #$request = new Subject<{
        payload: any,
        onSuccess?: (seq: number) => void
    }>()

    public readonly $status = new BehaviorSubject('created') as ConnectionStatus
    public readonly $subDevReports = new Subject<{
        id: string
        online: boolean
    }>

    #$metadata = new BehaviorSubject<DiscoverPayload | undefined>(undefined)
    #stop = new BehaviorSubject(false)


    #DEBUG = false
    constructor(
        public readonly config: Omit<DeviceMetadata, 'ip' | 'version'>,
        private cids: DeviceMetadata[] | false | null
    ) {
        this.#DEBUG = !!(
            process.env.TUYA2MQTT_DEBUG == 'all'
            || process.env.TUYA2MQTT_DEBUG?.includes(this.config.id)
            || (
                this.config.uuid && process.env.TUYA2MQTT_DEBUG?.includes(this.config.uuid)
            )
        )
        this.#$metadata.pipe(
            takeUntil(this.stoppped$),
            filter(Boolean),
            exhaustMap($ => this.#connect($))
        ).subscribe()
    }

    async #tcp({ ip, version }: DiscoverPayload) {

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
            ))
        if (!socket) return

        const parser = new MessageParser({
            key: this.config.local_key,
            version
        })

        let seq = 100
        const connection = merge(

            // Map response
            fromEvent(socket, 'data').pipe(
                tap(() => this.$status.getValue() != 'online' && this.$status.next('online')),
                map(data => parser.parse(data) as Array<CmdResponse>),
                mergeAll(),
                tap(data => {
                    seq = Math.max(data.sequenceN, seq)
                    const p = data.payload as { dps: Dps, cid: string }
                    if (p.dps || p.cid) {
                        const id = p.cid || this.config.id
                        const $dps = this.#devices.get(id)
                        if ($dps) {
                            if (Object.keys(p.dps).some(key => p.dps[key] != $dps.getValue()[key])) {
                                $dps.next(p.dps || {})
                            }
                        }
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
                mergeMap(async ({ payload, onSuccess }) => {
                    const sequenceN = ++seq
                    const buffer = parser.encode({
                        ...payload,
                        sequenceN
                    })
                    if (!socket.writable) return onSuccess?.(-1)
                    const error = await new Promise(s => {
                        // @ts-ignore
                        socket.write(buffer, s)
                    })
                    return onSuccess?.(error ? -1 : sequenceN)
                }, 1)
            ),


            // interval ping
            interval(5000).pipe(
                tap(() => this.cids ? this.sync() : this.refresh())
            )
        ).pipe(
            finalize(() => socket.end())
        ).subscribe()



        this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}]  <${this.config.id}> ${this.config.name}  Syncing [protocol ${version}]`)
        const decrypted = version == '3.4' ? await this.#setup34Protocol(parser) : true
        if (!decrypted) {
            console.error(`[${new Date().toLocaleString()}] [${ip}] <${this.config.id}> Can not setup 3.4 protocol`)
            connection.unsubscribe()
            return
        }

        return {
            timeout$: firstValueFrom(merge(

                // Timeout
                fromEvent<Buffer>(socket, 'data').pipe(
                    debounceTime(10000),
                    finalize(() => connection.unsubscribe()),
                    map(() => 'TIMEOUT' as 'TIMEOUT')
                ),

                // Close
                fromEvent(socket, 'close'),
                fromEvent(socket, 'error'),

                // Stop
                this.#stop.pipe(filter(Boolean))
            ))
        }

    }

    async #connect($: DiscoverPayload) {

        if (this.$status.getValue() == 'online' || this.$status.getValue() == 'connecting') return
        this.$status.next('connecting')
        this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${$.ip}] <${this.config.id}>  ${this.config.name}:  Connecting to ${this.config.name} - ip ${$.ip} `)
        const connection = await this.#tcp($)
        if (connection) {
            this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${$.ip}] <${this.config.id}>  ${this.config.name}: ONLINE [protocol ${$.version}]`)
            await connection.timeout$
            this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${$.ip}] <${this.config.id}>  ${this.config.name}: OFFLINE`)
        } else {
            this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${$.ip}] <${this.config.id}>  ${this.config.name}: Can not connect to ${this.config.name} - ip ${$.ip} `)
        }
        this.$status.next('offline')
    }

    connect(info: DiscoverPayload) {
        this.#$metadata.next({ ...info, version: `${info.version}` })
    }

    get stoppped$() {
        return this.#stop.pipe(filter(Boolean))
    }

    async #setup34Protocol(parser: MessageParser) {

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
        })

        // Calculate session key
        // @ts-ignore
        const sessionKey = Buffer.from(temp_local_key);
        for (let i = 0; i < temp_local_key.length; i++) {
            sessionKey[i] = temp_local_key[i] ^ temp_remote_key[i];
        }

        const sessionKey2 = parser.cipher._encrypt34({ data: sessionKey });

        parser.cipher.setSessionKey(sessionKey2)

        return true
    }

    async cmd(payload: any, wait = true, timeout: number = 3000) {

        return await firstValueFrom(merge(
            timer(timeout).pipe(
                map(() => null)
            ),
            new Observable<number>(o => (
                this.#$request.next({
                    payload,
                    onSuccess: seq => o.next(seq)
                })
            )).pipe(
                take(1),
                switchMap(seq => {
                    if (seq < 0 || !wait) return of(null)
                    return this.#$response.pipe(
                        filter(r => seq == 101 ? true : r.sequenceN == seq),
                        filter(r => (r.payload as any) != false),
                        map(r => r.payload),
                    )
                })
            ))
        )
    }

    async refresh() {
        const broadcast_metadata = this.#$metadata.getValue()
        if (!broadcast_metadata) return
        const { version } = broadcast_metadata
        const t = Math.round(new Date().getTime() / 1000).toString()
        const ids = [4, 5, 6, 18, 19, 20]

        if (version == '3.4' || version == '3.5') return await this.cmd({
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

        return await this.cmd({
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

    async setDps(data: { dps: Dps, sub_device_id?: string }) {
        const broadcast_metadata = this.#$metadata.getValue()
        if (!broadcast_metadata) return
        const { version } = broadcast_metadata


        const t = Math.round(new Date().getTime() / 1000).toString()

        if (version == '3.4' || version == '3.5') return await this.cmd({
            commandByte: CommandType.CONTROL_NEW,
            data: {
                data: {
                    ctype: 0,
                    ...data.sub_device_id ? {
                        dps: data.dps,
                        cid: data.sub_device_id
                    } : {
                        gwId: this.config.id,
                        devId: this.config.id,
                        dps: data.dps,
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
                ...data.sub_device_id ? {
                    dps: data.dps,
                    cid: data.sub_device_id
                } : {
                    gwId: this.config.id,
                    devId: this.config.id,
                    dps: data.dps,
                    uid: this.config.id,
                }
            }
        })
    }

    async sync(sub_device_id?: string) {
        const broadcast_metadata = this.#$metadata.getValue()
        if (!broadcast_metadata) return
        const { version } = broadcast_metadata
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
        }, true, 1000) as { dps?: any }
        if (dps as string == 'json obj data unvalid') {
            const id = sub_device_id || this.config.id
            // this.#devices.get(id)?.forEach(s => s.next({}))
            // console.error(`CAN NOT SYNC ${this.config.name} - json obj data unvalid`)
        }
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

    registerDps(device_id: string = this.config.id) {
        const $dps = this.#devices.get(device_id) || new BehaviorSubject<Dps>({})
        !this.#devices.has(device_id) && this.#devices.set(device_id, $dps)
        return [
            $dps,
            () => this.#devices.delete(device_id)
        ] as [Observable<Dps>, Function]
    }

    close() {
        this.#stop.next(true)
    }

}
