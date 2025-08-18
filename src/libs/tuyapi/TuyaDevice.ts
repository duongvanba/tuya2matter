import { BehaviorSubject, Subject, filter, groupBy, map, mergeMap, skip, tap } from "rxjs";
import { ConnectionStatusCode, Dps, TuyaConnection  } from "./TuyaConnection.js";
import { DeviceMetadata } from "./DeviceMetadata.js";

type LastCommandState = {
    [key: string]: string | boolean | number
}

export class TuyaDevice {

    #last_command_state: LastCommandState = {}
    #last_dps: Dps = {}
    public readonly $dps = new Subject<Dps>()
    public readonly $status = new BehaviorSubject<ConnectionStatusCode>('connecting')


    #convert_to_string_key_dps(dps: Dps) {
        return Object.entries(dps).reduce(
            (p, [key, value]) => {
                const mapped_key = isNaN(Number(key)) ? key : this.config.mapping[key].code
                if (!mapped_key) return p
                return { ...p, [mapped_key]: value }
            },
            {} as Dps
        )
    }

    #convert_to_number_key_dps(dps: Dps) {
        return Object.entries(dps).reduce(
            (p, [key, value]) => {
                const mapped_key = isNaN(Number(key)) ? this.config.mapping[key].dp_id : key
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
        connection.register_device_dps(config.node_id).pipe(
            map(dps => this.#convert_to_string_key_dps(dps)),
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
        ).subscribe()

        connection.$status.pipe(
            filter(status => status != 'online')
        ).subscribe(this.$status)

        // Sync state with last command
        this.$status.pipe(
            filter(status => status == 'online'),
            filter(() => Object.keys(this.#last_command_state).length > 0)
        ).subscribe(() => {
            const dps = { ...this.#last_command_state }
            this.#last_command_state = {}
            this.set_dps(dps)
        })

        this.$dps.subscribe(dps => {
            this.#last_dps = {
                ... this.#last_dps,
                ...dps
            }
        })


        this.connection.$sub_dev_reports.pipe(
            filter(d => d.id == config.node_id),
            tap(dev => this.$status.next(dev.online ? 'online' : 'offline'))
        ).subscribe()


    }


    get uniquee_device_id() {
        return this.config.node_id || this.device_id
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

    get category(){
        return this.config.category
    }


    set_dps(raw_dps: Dps) {
        if (Object.keys(raw_dps).length == 0) return

        this.#last_command_state = {
            ... this.#last_command_state,
            ...raw_dps
        }


        return this.connection.set_dps({
            sub_device_id: this.config.node_id,
            dps: this.#convert_to_number_key_dps(raw_dps)
        })
    }

    get_last_dps() {
        return { ... this.#last_dps }
    }

    listen_dps<T = string | number | boolean>(dp_code, fn: (value: T) => void) {
        const mapping = this.config.mapping[dp_code]
        if (!mapping) return
        return this.$dps.subscribe(dps => {
            if (dps[mapping.code] === undefined) return
            fn(dps[mapping.code] as T)
        })
    }

    async sync() {
        await this.connection.sync(this.config.node_id)
    }


}
