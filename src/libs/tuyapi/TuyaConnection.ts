import { BehaviorSubject, Observable, Subject, exhaustMap, filter, finalize, firstValueFrom, fromEvent, interval, map, merge, mergeAll, mergeMap, of, switchMap, take, takeUntil, tap, timer } from 'rxjs'
import { CommandType, MessageParser } from './message-parser.js'
import dgram from 'dgram'
import { createHash } from 'crypto'
import { TuyaSocket } from './TuyaSocket.js'
import { DeviceMetadata } from './DeviceMetadata.js'

const cap_first_char = (str: string) => `${str[0].toUpperCase}${str.slice(1)}`


export type ApiCredential = {
    key: string,
    secret: string,
    user_id: string,
    region?: string
}

type DiscoverPayload = {
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

    #devices = new Map<string, Array<Subject<Dps>>>()

    #$response = new Subject<CmdResponse>()

    #$request = new Subject<{
        payload: any,
        on_success?: (seq: number) => void
    }>()

    public readonly $status = new BehaviorSubject('created') as ConnectionStatus
    public readonly $sub_dev_reports = new Subject<{
        id: string
        online: boolean
    }>

    #$broadcast_metadata = new BehaviorSubject<{ ip: string, version: string } | undefined>(undefined)


    #DEBUG = false
    constructor(
        public readonly config: Omit<DeviceMetadata, 'ip' | 'version'>,
        private cids: DeviceMetadata[] | false | null
    ) {
        this.#DEBUG = !!(
            process.env.TUYA2MQTT_DEBUG == 'all'
            || process.env.TUYA2MQTT_DEBUG?.includes(this.config.id)
            || (
                this.config.node_id && process.env.TUYA2MQTT_DEBUG?.includes(this.config.node_id)
            )
        )
        this.#$broadcast_metadata.pipe(
            filter(Boolean),
            exhaustMap(async ({ ip, version }) => {

                if (this.$status.getValue() == 'online' || this.$status.getValue() == 'connecting') return


                this.$status.next('connecting')
                await Bun.sleep(1000)
                this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    => Connecting to ${this.config.name} - ip ${ip} `)

                const { $error, end, socket } = await TuyaSocket.init(this.config.name, ip, this.config.port || 6668)
                if (!socket) return

                const parser = new MessageParser({
                    key: this.config.local_key,
                    version
                })

                // Map response 
                let $seq = 100
                fromEvent(socket, 'data').pipe(
                    takeUntil($error),
                    tap(() => this.$status.getValue() != 'online' && this.$status.next('online')),
                    map(data => parser.parse(data) as Array<CmdResponse>),
                    mergeAll(),
                    tap(data => {
                        $seq = Math.max(data.sequenceN, $seq)
                        const p = data.payload as { dps: Dps, cid: string }
                        if (p.dps || p.cid) {
                            const id = p.cid || this.config.id
                            this.#devices.get(id)?.forEach(s => s.next(p.dps || {}))
                        }

                        const pp = data.payload as SubDeviceReport
                        if (pp.reqType == 'subdev_online_stat_report') {
                            pp.data.online?.forEach(id => this.$sub_dev_reports.next({ id, online: true }))
                            pp.data.offline?.forEach(id => this.$sub_dev_reports.next({ id, online: false }))
                        }

                        this.#$response.next(data)
                    })
                ).subscribe()

                // Map request 
                this.#$request.pipe(
                    takeUntil($error),
                    mergeMap(async ({ payload, on_success }) => {
                        const sequenceN = ++$seq
                        const buffer = parser.encode({
                            ...payload,
                            sequenceN
                        })
                        if (!socket.writable) return on_success?.(-1)
                        const error = await new Promise(s => {
                            // @ts-ignore
                            socket.write(buffer, s)
                        })
                        return on_success?.(error ? -1 : sequenceN)
                    }, 1)
                ).subscribe()


                version == '3.4' && this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}>  ${this.config.name}: Encrypting 3.4 protocol`)
                const decrypted = version == '3.4' ? await this.#setup_3_4_protocol(parser) : true
                if (!decrypted) {
                    console.error(`[${new Date().toLocaleString()}] [${ip}] <${this.config.id}> Can not setup 3.4 protocol`)
                    end()
                    return
                }

                // this.$status.getValue() == 'connecting' && this.$status.next('online')

                // Syncing
                this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}> ${this.config.name} Syncing [protocol ${version}]`)

                await this.refresh()
                const a = Date.now()
                await this.sync_all()

                this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}>  ${this.config.name}: Synced [protocol ${version}] in ${Date.now() - a} m`)
                this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    [${ip}] <${this.config.id}>  ${this.config.name}: ONLINE [protocol ${version}]`)
                interval(5000).pipe(
                    takeUntil($error),
                    map(() => cids ? this.refresh() : this.sync())
                ).subscribe()

                const offline_reason = await $error
                this.#DEBUG && console.log(`[${new Date().toLocaleString()}] [${ip}] <${this.config.id}>  ${this.config.name}: OFFLINE [reason ${offline_reason}]`)
                this.#DEBUG && console.log(`[${new Date().toLocaleString()}]    => Can not connect to ${this.config.name} - ip ${ip} `)
                this.$status.next('offline')
            })

        ).subscribe()
    }


    connect(info: { ip, version }) {
        this.#$broadcast_metadata.next({ ...info, version: `${info.version}` })
    }

    async #setup_3_4_protocol(parser: MessageParser) {

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
                    on_success: seq => o.next(seq)
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
        const broadcast_metadata = this.#$broadcast_metadata.getValue()
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

    async set_dps(data: { dps: Dps, sub_device_id?: string }) {
        const broadcast_metadata = this.#$broadcast_metadata.getValue()
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
        const broadcast_metadata = this.#$broadcast_metadata.getValue()
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
            this.#devices.get(id)?.forEach(s => s.next({}))
        }
        return dps
    }

    async sync_all() {
        if (!this.cids) {
            await this.sync()
            return
        }
        for (const cid of this.cids) {
            await this.sync(cid.id)
        }
    }

    register_device_dps(device_id: string = this.config.id) {
        const $dps = new Subject<Dps>()
        this.#devices.set(device_id, [
            ... this.#devices.get(device_id) || [],
            $dps
        ])
        return $dps
    }

}
