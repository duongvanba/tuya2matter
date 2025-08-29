import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { Tuya2MatterSwitch } from "./Tuya2MatterSwitch.js";
import { Tuya2MatterCover } from "./Tuya2MatterCover.js";
import { Tuya2MatterOccupancySensor } from "./Tuya2MatterOccupancySensor.js";
import { Tuya2MatterBinarySensor } from "./Tuya2MatterBinarySensor.js";
import { Tuya2MatterButton } from "./Tuya2MatterButton.js";
import { BehaviorSubject, filter, from, merge, of, skip, switchMap, takeUntil, tap } from "rxjs";
import { Tuya2MatterTemperatureLight } from "./Tuya2MatterTemperatureLight.js";
import { Tuya2MatterFan } from "./Tuya2MatterFan.js";



export class Tuya2Matter {

    #stop = new BehaviorSubject(false)

    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    #getMapper() {
        if (['kg', 'tdq', 'cz'].includes(this.tuya.category)) return new Tuya2MatterSwitch(this.aggregator, this.tuya)
        if (this.tuya.category == 'cl') return new Tuya2MatterCover(this.aggregator, this.tuya)
        if (this.tuya.category == 'hps') return new Tuya2MatterOccupancySensor(this.aggregator, this.tuya)
        if (this.tuya.category == 'mcs') return new Tuya2MatterBinarySensor(this.aggregator, this.tuya)
        if (this.tuya.category == 'wxkg') return new Tuya2MatterButton(this.aggregator, this.tuya)
        if (this.tuya.category == 'dd') return new Tuya2MatterTemperatureLight(this.aggregator, this.tuya)
        if (this.tuya.category == 'fs') return new Tuya2MatterFan(this.aggregator, this.tuya)
    }

    async init() {
        const device = this.#getMapper()
        if (!device) return
        const link = device.link()

        for (const e of link.endpoints) {
            await this.aggregator.add(e)
        }

        merge(
            // Sync state
            link.observable,

            // First sync
            from(this.tuya.sync()).pipe(
                switchMap(() => this.tuya.$status),
                tap(status => {
                    link.endpoints.forEach(
                        e => e.set({ bridgedDeviceBasicInformation: { reachable: status == 'online' } } as any)
                    )
                })
            )

        ).pipe(
            takeUntil(this.#stop.pipe(filter(Boolean)))
        ).subscribe()
    }

    stop() {
        this.#stop.next(true)
    }


}