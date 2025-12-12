import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint } from "@matter/main";
import { Tuya2MatterSwitch } from "./Tuya2MatterSwitch.js";
import { Tuya2MatterCover } from "./Tuya2MatterCover.js";
import { Tuya2MatterOccupancySensor } from "./Tuya2MatterOccupancySensor.js";
import { Tuya2MatterBinarySensor } from "./Tuya2MatterBinarySensor.js";
import { Tuya2MatterButton } from "./Tuya2MatterButton.js";
import { BehaviorSubject, filter, finalize, merge, takeUntil, tap } from "rxjs";
import { Tuya2MatterTemperatureLight } from "./Tuya2MatterTemperatureLight.js";
import { Tuya2MatterFan } from "./Tuya2MatterFan.js";
import { Tuya2MatterLock } from "./Tuya2MatterLock.js";
import { Tuya2MatterAirSensor } from "./Tuya2MatterAirSensor.js";



export class Tuya2Matter {

    #stop = new BehaviorSubject(false)

    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) {  
    }

    #getMapper() {
        if (['kg', 'tdq', 'cz', 'znjdq', 'pc'].includes(this.tuya.category)) return new Tuya2MatterSwitch(this.aggregator, this.tuya)
        if (['clkg', 'cl'].includes(this.tuya.category)) return new Tuya2MatterCover(this.aggregator, this.tuya)
        if (this.tuya.category == 'hps') return new Tuya2MatterOccupancySensor(this.aggregator, this.tuya)
        if (this.tuya.category == 'mcs') return new Tuya2MatterBinarySensor(this.aggregator, this.tuya)
        if (this.tuya.category == 'wxkg') return new Tuya2MatterButton(this.aggregator, this.tuya)
        if (this.tuya.category == 'dd') return new Tuya2MatterTemperatureLight(this.aggregator, this.tuya)
        if (this.tuya.category == 'fs') return new Tuya2MatterFan(this.aggregator, this.tuya)
        if (this.tuya.category == 'jtmspro') return new Tuya2MatterLock(this.aggregator, this.tuya)
        if (this.tuya.category == 'hjjcy') return new Tuya2MatterAirSensor(this.aggregator, this.tuya)


    }

    async init() {
        const device = this.#getMapper()
        if (!device) return
        const link = device.link()

        await this.aggregator.add(link.endpoint)

        merge(
            // Sync state
            link.observable,

            // First sync
            this.tuya.$status.pipe(
                tap(status => { 
                    const reachable = status == 'online'
                    link.endpoint.set({ bridgedDeviceBasicInformation: { reachable } })
                    reachable && console.log(`[${new Date().toLocaleString()}] <${device.tuya.id}> [MATTER-READY]  ${device.tuya.name}\n`)
                })
            )

        ).pipe(
            takeUntil(this.#stop.pipe(filter(Boolean))),
            finalize(() => link.endpoint.delete())
        ).subscribe()
    }

    stop() {
        this.#stop.next(true)
    }


}