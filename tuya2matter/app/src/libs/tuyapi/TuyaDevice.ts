import { BehaviorSubject, EMPTY, ReplaySubject, filter, finalize, map, merge, mergeMap, take, takeUntil, tap } from "rxjs";
import { ConnectionStatusCode, RawDps, ReadableDps, TuyaLocal } from "./TuyaLocal.js";
import { DeviceMetadata } from "./DeviceMetadata.js";
import { TuyaCloud } from "./TuyaCloud.js";


export class TuyaDevice {


    public readonly $dps = new BehaviorSubject<{ state: ReadableDps, last: ReadableDps, pending: ReadableDps }>({
        last: {},
        state: {},
        pending: {}
    })
    public readonly $status = new BehaviorSubject<ConnectionStatusCode>('created')
    #stop$ = new ReplaySubject(1)
    #local?: TuyaLocal
    #cloud?: TuyaCloud


    #toReadableDps(dps: RawDps) {
        return Object.entries(dps).reduce(
            (p, [key, value]) => {
                const mapped_key = this.config.mapping[`${key}`]?.code
                if (!mapped_key) return p
                return { ...p, [`${mapped_key}`]: value }
            },
            {} as ReadableDps
        )
    }

    #toRawDps(dps: ReadableDps) {
        return Object.entries(dps).reduce(
            (p, [key, value]) => {
                const mapped_key = this.config.mapping[`${key}`]?.dp_id
                if (!mapped_key) return p
                return { ...p, [Number(mapped_key)]: value }
            },
            {} as RawDps
        )
    }


    constructor(public readonly config: DeviceMetadata) { }

    linkLocal(connection: TuyaLocal) {
        this.#local = connection
        const device_node_id = this.config.sub ? this.config.node_id : this.config.id

        return merge(
            // Dps sync 
            connection.registerDps(device_node_id).pipe(
                filter(Boolean),
                map(dps => this.#toReadableDps(dps)),
                tap(dps => {
                    if (Object.keys(dps).length > 0) {
                        this.$dps.next({
                            ... this.$dps.value,
                            last: dps,
                            state: {
                                ... this.$dps.value.state,
                                ...dps
                            }
                        })
                        this.$status.getValue() != 'online' && this.$status.next('online')
                    }
                }),

            ),

            // Sync first state
            connection.$status.pipe(
                filter(status => status == 'online' && this.$status.value != 'online'),
                tap(() => connection.sync(device_node_id))
            ),


            // sync offline
            connection.$status.pipe(
                filter(status => status != 'online'),
                tap(() => this.$status.value != 'offline' && this.$status.next('offline'))
            ),

            // Sync state with last command
            connection.$status.pipe(
                filter(status => status == 'online'),
                filter(() => Object.keys(this.$dps.value.pending).length > 0),
                mergeMap(async () => {
                    const pending = this.$dps.value.pending
                    this.$dps.next({
                        ... this.$dps.value,
                        last: {},
                        pending: {}
                    })
                    await connection.setDps(
                        this.#toRawDps(pending),
                        this.config.sub ? this.config.node_id : undefined
                    )
                })
            ),


            // Sync with sub report from connection
            connection.$subDevReports.pipe(
                filter(d => d.id == this.config.node_id),
                tap(dev => this.$status.next(dev.online ? 'online' : 'offline'))
            )
        ).pipe(
            takeUntil(this.#stop$),
            takeUntil(connection.stop$),
            finalize(() => {
                this.#local = undefined
                this.#recheck()
            })
        ).subscribe()
    }

    linkCloud(cloud: TuyaCloud) {
        return merge(

            // Sync remote dps to local
            cloud.watch(this.config.id).pipe(
                tap(() => {
                    // Sync dps
                })
            )

        ).pipe(
            finalize(() => {
                this.#cloud = undefined
                this.#recheck()
            })
        ).subscribe()
    }

    #recheck() {
        const local = this.#local ? (this.#local.$status.getValue() == 'online') : false
        const cloud = this.#cloud ? this.#cloud.online$.getValue() : false

        if (!cloud && !local) {
            this.$status.next('offline')
        }
    }

    get mapping() {
        return this.config.mapping
    }

    get device_id() {
        return this.config.id
    }

    get id() {
        return this.config.id
    }

    get category() {
        return this.config.category
    }

    get name() {
        return this.config.name
    }


    async setDps(dps: ReadableDps) {
        if (Object.keys(dps).length == 0) return
        if (Object.entries(dps).every(([code, v]) => v == this.$dps.value.state[code])) return

        if (this.#local) {
            if (this.#local.$status.value == 'online') {
                await this.#local.setDps(
                    this.#toRawDps(dps),
                    this.config.sub ? this.config.node_id : undefined
                )
            } else {
                this.$dps.next({
                    ... this.$dps.value,
                    last: {},
                    pending: {
                        ... this.$dps.value.pending,
                        ...dps
                    }
                })
            }
            return
        }
        await this.#cloud?.sendCommand(this.config.id, this.#toReadableDps(dps))

    }

    listenDps<T>(dp_code: string) {
        const mapping = this.config.mapping[dp_code]
        if (!mapping) return EMPTY
        return this.$dps.pipe(
            map(v => v.last),
            map(dps => dps[mapping.code] as T),
            filter(v => v == undefined)
        )
    }




    close() {
        this.#stop$.next(true)
    }





}
