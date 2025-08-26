import { Injectable } from "@nestjs/common";
import { MatterService } from "./Matter.js";
import { TuyaDeviceService } from "./TuyaDeviceService.js";
import { filter, mergeMap, switchMap } from "rxjs";
import { Tuya2Matter } from "../libs/tuya2matter/Tuya2Matter.js";


@Injectable()
export class SyncService {


    constructor(
        devices$: TuyaDeviceService,
        matter: MatterService
    ) {
        matter.aggregator$.pipe(
            switchMap(aggregator => {
                return devices$.pipe(
                    mergeMap(async device => {
                        const linker = new Tuya2Matter(aggregator, device)
                        await linker.init()
                        console.log(`[${new Date().toLocaleString()}]    [${device.config.ip}] <${device.config.id}>  ${device.config.name}:  Matter ready`)
                    })
                )
            }),

        ).subscribe()
    }
}