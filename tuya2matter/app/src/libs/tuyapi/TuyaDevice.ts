import { BehaviorSubject, EMPTY, Subject, filter, finalize, map, merge, takeUntil, tap } from "rxjs";
import { ConnectionStatusCode, Dps, TuyaConnection } from "./TuyaConnection.js";
import { DeviceMetadata } from "./DeviceMetadata.js";


type LastCommandState = {
    [key: string]: string | boolean | number
}

export class TuyaDevice {

    #last_command_state: LastCommandState = {}
    #last_dps: Dps = {}
    public readonly $dps = new Subject<Dps>()
    public readonly $status = new BehaviorSubject<ConnectionStatusCode>('created')
    #stop = new BehaviorSubject(false)

    #toReadableDps(dps: Dps) {
        return Object.entries(dps).reduce(
            (p, [key, value]) => {
                const mapped_key = this.config.mapping[`${key}`]?.code
                if (!mapped_key) return p
                return { ...p, [mapped_key]: value }
            },
            {} as Dps
        )
    }

    #toRawDps(dps: Dps) {
        return Object.entries(dps).reduce(
            (p, [key, value]) => {
                const mapped_key = this.config.mapping[`${key}`]?.dp_id
                if (!mapped_key) return p
                return { ...p, [mapped_key]: value }
            },
            {} as Dps
        )
    }



    constructor(
        private connection: TuyaConnection,
        public readonly config: DeviceMetadata
    ) {
        const [dps$, unregister] = connection.registerDps(config.uuid)
        merge(

            // Dps sync
            dps$.pipe(
                map(dps => this.#toReadableDps(dps)),
                tap(dps => {
                    if (Object.keys(dps).length > 0) {
                        this.$dps.next({
                            ...dps,
                            $status: this.$status.getValue()
                        })
                        this.#last_command_state = {}
                    }
                }),
                tap(() => this.$status.getValue() != 'online' && this.$status.next('online')),
            ),

            //Status sync
            connection.$status.pipe(
                filter(status => status != 'online'),
                tap(s => this.$status.next(s))
            ),


            // Sync state with last command
            this.$status.pipe(
                filter(status => status == 'online'),
                filter(() => Object.keys(this.#last_command_state).length > 0),
                tap(() => {
                    const dps = { ...this.#last_command_state }
                    this.#last_command_state = {}
                    this.setDps(dps)
                })
            ),


            // Cache dps
            this.$dps.pipe(
                tap(dps => {
                    this.#last_dps = {
                        ... this.#last_dps,
                        ...dps
                    }
                })
            ),


            // Sync with sub report from connection
            this.connection.$subDevReports.pipe(
                filter(d => d.id == config.uuid),
                tap(dev => this.$status.next(dev.online ? 'online' : 'offline'))
            )
        ).pipe(
            takeUntil(this.#stop.pipe(filter(Boolean))),
            takeUntil(connection.stoppped$),
            finalize(() => unregister())
        ).subscribe()



    }


    get uniquee_device_id() {
        return this.config.uuid || this.device_id
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


    setDps(raw_dps: Dps) {
        if (Object.keys(raw_dps).length == 0) return

        this.#last_command_state = {
            ... this.#last_command_state,
            ...raw_dps
        }


        return this.connection.setDps({
            sub_device_id: this.config.uuid,
            dps: this.#toRawDps(raw_dps)
        })
    }

    getLastDps() {
        return { ... this.#last_dps }
    }

    listenDps<T>(dp_code) {
        const mapping = this.config.mapping[dp_code]
        if (!mapping) return EMPTY
        return this.$dps.pipe(
            map(dps => dps[mapping.code] as T),
            filter(v => v == undefined)
        )
    }

    async sync() {
        await this.connection.sync(this.config.uuid)
    }

    close() {
        this.#stop.next(true)
    }


}
